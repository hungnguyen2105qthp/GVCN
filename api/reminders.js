function json(response, status, body) {
  response.status(status).json(body);
}

function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    json(response, 405, { error: "Phương thức không được hỗ trợ." });
    return;
  }

  const { SUPABASE_URL: rawUrl, SUPABASE_ANON_KEY: anonKey } = process.env;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !anonKey || !serviceKey) {
    json(response, 503, { error: "Thiếu cấu hình Supabase phía máy chủ." });
    return;
  }

  const url = rawUrl.replace(/\/+$/, "");
  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    json(response, 401, { error: "Cần đăng nhập để gửi lời nhắc." });
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
    profileUrl.searchParams.set("select", "id,username,full_name,role,student_id,class_id");
    const profileResponse = await fetch(profileUrl, { headers: supabaseHeaders(serviceKey) });
    const profiles = await readJson(profileResponse);
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profileResponse.ok) throw new Error("Không thể xác minh tài khoản gửi lời nhắc.");
    if (!profile) {
      json(response, 403, { error: "Tài khoản chưa có hồ sơ trong lớp." });
      return;
    }

    const body = request.body || {};
    const message = String(body.message || "").trim();
    const recipientIds = Array.isArray(body.recipientIds)
      ? [...new Set(body.recipientIds.map(id => String(id).trim()).filter(Boolean))]
      : [];
    if (!message || message.length > 500 || !recipientIds.length) {
      json(response, 400, { error: "Lời nhắc cần có nội dung (tối đa 500 ký tự) và ít nhất một người nhận." });
      return;
    }

    const classDataUrl = new URL(`${url}/rest/v1/class_data`);
    classDataUrl.searchParams.set("class_id", `eq.${profile.class_id}`);
    classDataUrl.searchParams.set("select", "state");
    const classResponse = await fetch(classDataUrl, { headers: supabaseHeaders(serviceKey) });
    const classRows = await readJson(classResponse);
    if (!classResponse.ok) throw new Error("Không thể tải danh sách học sinh của lớp.");
    const classState = Array.isArray(classRows) && classRows[0] ? classRows[0].state || {} : {};
    const students = Array.isArray(classState.students) ? classState.students : [];
    const studentsById = new Map(students.map(student => [String(student.id), student]));
    if (recipientIds.some(id => !studentsById.has(id))) {
      json(response, 400, { error: "Danh sách người nhận có học sinh không thuộc lớp này." });
      return;
    }

    if (profile.role !== "gvcn") {
      if (profile.role !== "bcs" || !profile.student_id) {
        json(response, 403, { error: "Tài khoản này không có quyền gửi lời nhắc." });
        return;
      }
      const sender = studentsById.get(String(profile.student_id));
      const senderRole = String(sender && sender.role || "").trim().toLocaleLowerCase("vi");
      let allowedStudents = [];
      if (senderRole.includes("lớp trưởng")) {
        allowedStudents = students;
      } else if (senderRole.includes("tổ trưởng") && sender && String(sender.group || "").trim()) {
        allowedStudents = students.filter(student =>
          String(student.group || "").trim() === String(sender.group).trim()
        );
      } else {
        json(response, 403, { error: "Chỉ lớp trưởng và tổ trưởng mới được gửi lời nhắc." });
        return;
      }
      const allowedIds = new Set(allowedStudents.map(student => String(student.id)));
      if (recipientIds.some(id => !allowedIds.has(id))) {
        json(response, 403, {
          error: senderRole.includes("tổ trưởng")
            ? "Tổ trưởng chỉ được nhắc thành viên trong tổ của mình."
            : "Lời nhắc có người nhận ngoài lớp.",
        });
        return;
      }
    }

    const insertResponse = await fetch(`${url}/rest/v1/class_reminders`, {
      method: "POST",
      headers: supabaseHeaders(serviceKey, { Prefer: "return=minimal" }),
      body: JSON.stringify({
        class_id: profile.class_id,
        recipient_ids: recipientIds,
        message,
        created_by: profile.id,
        sender_name: profile.role === "gvcn" ? "Giáo viên chủ nhiệm" : profile.full_name,
        sender_role: profile.role === "gvcn" ? "GVCN" : String((studentsById.get(String(profile.student_id)) || {}).role || "Ban cán sự"),
      }),
    });
    if (!insertResponse.ok) {
      const error = await readJson(insertResponse);
      if (error && error.code === "PGRST205") {
        throw new Error("Supabase chưa có bảng lời nhắc. Hãy chạy tệp supabase/add-class-reminders.sql trong Supabase SQL Editor rồi thử lại.");
      }
      throw new Error(error && error.message ? error.message : "Không thể lưu lời nhắc.");
    }
    json(response, 201, { ok: true });
  } catch (error) {
    json(response, 500, { error: error.message || "Không thể gửi lời nhắc do lỗi máy chủ." });
  }
};
