function json(response, status, body) {
  response.status(status).json(body);
}

function supabaseHeaders(key, extra = {}) {
  const headers = {
    apikey: key,
    "Content-Type": "application/json",
    ...extra,
  };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function getErrorMessage(body, fallback) {
  return body && (body.message || body.msg || body.error_description || body.error) || fallback;
}

function getAllowedStudentIds(profile, students) {
  if (profile.role === "gvcn") return new Set(students.map(student => String(student.id)));
  if (profile.role !== "bcs" || !profile.student_id) return null;

  const linkedStudent = students.find(student => String(student.id) === String(profile.student_id));
  const linkedRole = String(linkedStudent && linkedStudent.role || "").trim().toLocaleLowerCase("vi");
  if (linkedRole.includes("lớp trưởng")) {
    return new Set(students.map(student => String(student.id)));
  }
  if (linkedRole.includes("tổ trưởng") && linkedStudent && String(linkedStudent.group || "").trim()) {
    return new Set(students
      .filter(student => String(student.group || "").trim() === String(linkedStudent.group).trim())
      .map(student => String(student.id)));
  }
  return null;
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST, DELETE");
    json(response, 405, { error: "Phương thức không được hỗ trợ." });
    return;
  }

  const rawUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !anonKey || !serviceKey) {
    json(response, 503, { error: "Thiếu cấu hình Supabase trên máy chủ." });
    return;
  }

  const url = rawUrl.replace(/\/+$/, "");
  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    json(response, 401, { error: "Cần đăng nhập để sử dụng lời nhắc thời khóa biểu." });
    return;
  }

  try {
    const authResponse = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    const authUser = await readJson(authResponse);
    if (!authResponse.ok || !authUser || !authUser.id) {
      json(response, 401, { error: "Phiên đăng nhập không hợp lệ." });
      return;
    }

    const profileUrl = new URL(`${url}/rest/v1/profiles`);
    profileUrl.searchParams.set("id", `eq.${authUser.id}`);
    profileUrl.searchParams.set("select", "id,full_name,role,student_id,class_id");
    const profileResponse = await fetch(profileUrl, { headers: supabaseHeaders(serviceKey) });
    const profiles = await readJson(profileResponse);
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profileResponse.ok) {
      throw new Error(getErrorMessage(profiles, "Không thể xác minh tài khoản."));
    }
    if (!profile) {
      json(response, 403, { error: "Tài khoản chưa có hồ sơ trong lớp." });
      return;
    }

    if (request.method === "DELETE") {
      if (profile.role !== "gvcn") {
        json(response, 403, { error: "Chỉ GVCN mới được xóa lời nhắc thời khóa biểu." });
        return;
      }
      const reminderId = String(request.body && request.body.id || "").trim();
      if (!reminderId) {
        json(response, 400, { error: "Mã lời nhắc không hợp lệ." });
        return;
      }
      const deleteUrl = new URL(`${url}/rest/v1/timetable_reminders`);
      deleteUrl.searchParams.set("id", `eq.${reminderId}`);
      deleteUrl.searchParams.set("class_id", `eq.${profile.class_id}`);
      const deleteResponse = await fetch(deleteUrl, {
        method: "DELETE",
        headers: supabaseHeaders(serviceKey, { Prefer: "return=representation" }),
      });
      const deleted = await readJson(deleteResponse);
      if (!deleteResponse.ok) throw new Error(getErrorMessage(deleted, "Không thể xóa lời nhắc."));
      if (!Array.isArray(deleted) || !deleted.length) {
        json(response, 404, { error: "Không tìm thấy lời nhắc trong lớp." });
        return;
      }
      json(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET") {
      const remindersUrl = new URL(`${url}/rest/v1/timetable_reminders`);
      remindersUrl.searchParams.set("class_id", `eq.${profile.class_id}`);
      remindersUrl.searchParams.set("select", "*");
      remindersUrl.searchParams.set("order", "created_at.desc");
      const remindersResponse = await fetch(remindersUrl, { headers: supabaseHeaders(serviceKey) });
      const reminders = await readJson(remindersResponse);
      if (!remindersResponse.ok) {
        throw new Error(getErrorMessage(reminders, "Không thể tải lời nhắc thời khóa biểu."));
      }
      const visibleReminders = profile.role === "gvcn"
        ? reminders
        : (Array.isArray(reminders) ? reminders : []).filter(reminder =>
          Array.isArray(reminder.recipient_ids) &&
          reminder.recipient_ids.map(String).includes(String(profile.student_id))
        );
      json(response, 200, { reminders: visibleReminders });
      return;
    }

    if (profile.role !== "gvcn" && profile.role !== "bcs") {
      json(response, 403, { error: "Tài khoản này không có quyền gửi lời nhắc thời khóa biểu." });
      return;
    }

    const body = request.body || {};
    const day = Number(body.day);
    const session = String(body.session || "");
    const date = String(body.date || "");
    const message = String(body.message || "").trim();
    const subject = String(body.subject || "").trim();
    const period = String(body.period || "").trim();
    const time = String(body.time || "").trim();
    const recipientIds = Array.isArray(body.recipientIds)
      ? [...new Set(body.recipientIds.map(id => String(id).trim()).filter(Boolean))]
      : [];
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : null;
    const dateIsValid = parsedDate &&
      !Number.isNaN(parsedDate.getTime()) &&
      `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, "0")}-${String(parsedDate.getDate()).padStart(2, "0")}` === date &&
      (parsedDate.getDay() || 7) === day;
    if (
      !dateIsValid ||
      day < 1 ||
      day > 6 ||
      !["Sáng", "Chiều"].includes(session) ||
      !subject ||
      !period ||
      !message ||
      message.length > 500 ||
      !recipientIds.length
    ) {
      json(response, 400, { error: "Thông tin lời nhắc chưa hợp lệ." });
      return;
    }

    const classDataUrl = new URL(`${url}/rest/v1/class_data`);
    classDataUrl.searchParams.set("class_id", `eq.${profile.class_id}`);
    classDataUrl.searchParams.set("select", "state");
    const classResponse = await fetch(classDataUrl, { headers: supabaseHeaders(serviceKey) });
    const classRows = await readJson(classResponse);
    if (!classResponse.ok) throw new Error(getErrorMessage(classRows, "Không thể tải danh sách học sinh."));
    const classState = Array.isArray(classRows) && classRows[0] ? classRows[0].state || {} : {};
    const students = Array.isArray(classState.students) ? classState.students : [];
    const allowedStudentIds = getAllowedStudentIds(profile, students);
    if (!allowedStudentIds) {
      json(response, 403, { error: "Chỉ GVCN, lớp trưởng hoặc tổ trưởng mới được gửi lời nhắc." });
      return;
    }
    if (recipientIds.some(id => !allowedStudentIds.has(id))) {
      json(response, 403, { error: "Người nhận nằm ngoài phạm vi được phân công." });
      return;
    }

    const linkedStudent = students.find(student => String(student.id) === String(profile.student_id));
    const insertResponse = await fetch(`${url}/rest/v1/timetable_reminders`, {
      method: "POST",
      headers: supabaseHeaders(serviceKey, { Prefer: "return=representation" }),
      body: JSON.stringify({
        class_id: profile.class_id,
        day,
        reminder_date: date,
        session,
        period,
        time,
        subject,
        message,
        recipient_ids: recipientIds,
        created_by: profile.id,
        sender_name: profile.role === "gvcn" ? "Giáo viên chủ nhiệm" : profile.full_name,
        sender_role: profile.role === "gvcn"
          ? "GVCN"
          : String(linkedStudent && linkedStudent.role || "Ban cán sự"),
      }),
    });
    const inserted = await readJson(insertResponse);
    if (!insertResponse.ok) {
      throw new Error(getErrorMessage(inserted, "Không thể lưu lời nhắc thời khóa biểu."));
    }
    json(response, 201, { reminder: Array.isArray(inserted) ? inserted[0] : null });
  } catch (error) {
    json(response, 500, { error: error.message || "Không thể xử lý lời nhắc thời khóa biểu." });
  }
};
