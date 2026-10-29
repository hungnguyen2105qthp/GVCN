const encoder = new TextEncoder();

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

function supabaseErrorMessage(body, fallback) {
  return body && (body.msg || body.message || body.error_description || body.error) || fallback;
}

function supabaseRequestError(response, body, fallback) {
  const code = body && body.code ? `, mã ${body.code}` : "";
  const detail = supabaseErrorMessage(body, fallback);
  return new Error(`Supabase HTTP ${response.status}${code}: ${detail}`);
}

async function handleCreate(config, body, classId) {
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = body.role === "bcs" ? "bcs" : body.role === "hocsinh" ? "hocsinh" : "";
  const studentId = String(body.studentId || "").trim();
  const studentRole = role === "bcs" ? String(body.studentRole || "") : "";

  if (
    !/^[a-z0-9._-]{2,64}$/.test(username) ||
    password.length < 6 ||
    !role ||
    !studentId ||
    (studentRole && !["Lớp trưởng", "Tổ trưởng"].includes(studentRole))
  ) {
    throw new Error("Tài khoản, mật khẩu từ 6 ký tự, vai trò và học sinh liên kết là bắt buộc.");
  }

  const localPart = Array.from(encoder.encode(username.toLowerCase()), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const email = `u.${localPart}@accounts.example.com`;
  const classDataUrl = new URL(`${config.url}/rest/v1/class_data`);
  classDataUrl.searchParams.set("class_id", `eq.${classId}`);
  classDataUrl.searchParams.set("select", "state");
  const classResponse = await fetch(classDataUrl, {
    headers: supabaseHeaders(config.serviceKey),
  });
  const classRows = await readJson(classResponse);
  if (!classResponse.ok) {
    throw supabaseRequestError(classResponse, classRows, "Không thể tải dữ liệu lớp.");
  }
  const classState = Array.isArray(classRows) && classRows[0] ? classRows[0].state : null;
  const linkedStudent = classState && Array.isArray(classState.students)
    ? classState.students.find(student => String(student.id) === studentId)
    : null;
  if (!linkedStudent) throw new Error("Không tìm thấy học sinh liên kết trong dữ liệu lớp.");
  if (role === "bcs" && studentRole === "Tổ trưởng" && !String(linkedStudent.group || "").trim()) {
    throw new Error("Hãy phân học sinh vào một tổ trước khi cấp tài khoản tổ trưởng.");
  }

  const existingProfileUrl = new URL(`${config.url}/rest/v1/profiles`);
  existingProfileUrl.searchParams.set("student_id", `eq.${studentId}`);
  existingProfileUrl.searchParams.set("class_id", `eq.${classId}`);
  existingProfileUrl.searchParams.set("select", "id,username");
  const existingProfileResponse = await fetch(existingProfileUrl, {
    headers: supabaseHeaders(config.serviceKey),
  });
  const existingProfiles = await readJson(existingProfileResponse);
  if (!existingProfileResponse.ok) {
    throw supabaseRequestError(existingProfileResponse, existingProfiles, "Không thể kiểm tra tài khoản đã liên kết.");
  }
  if (Array.isArray(existingProfiles) && existingProfiles.length) {
    throw new Error(`Học sinh này đã có tài khoản (${existingProfiles[0].username}). Hãy xóa tài khoản cũ trước.`);
  }

  const createResponse = await fetch(`${config.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: supabaseHeaders(config.serviceKey),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  let user = await readJson(createResponse);
  let createdAuthUser = createResponse.ok;
  if (!createResponse.ok) {
    const message = String(supabaseErrorMessage(user, ""));
    const code = String(user && user.code || "");
    if (!["email_exists", "user_already_exists"].includes(code) && !/already registered|already been registered/i.test(message)) {
      throw supabaseRequestError(createResponse, user, "Không thể tạo tài khoản xác thực.");
    }

    const usersUrl = new URL(`${config.url}/auth/v1/admin/users`);
    usersUrl.searchParams.set("filter", email);
    usersUrl.searchParams.set("page", "1");
    usersUrl.searchParams.set("per_page", "1000");
    const usersResponse = await fetch(usersUrl, { headers: supabaseHeaders(config.serviceKey) });
    const usersResult = await readJson(usersResponse);
    const authUsers = Array.isArray(usersResult) ? usersResult : usersResult && usersResult.users;
    if (!usersResponse.ok) {
      throw supabaseRequestError(usersResponse, usersResult, "Không thể xác minh tài khoản Auth đã tồn tại.");
    }
    user = Array.isArray(authUsers)
      ? authUsers.find(candidate => String(candidate.email || "").toLowerCase() === email)
      : null;
    if (!user || !user.id) {
      throw supabaseRequestError(createResponse, user, "Email đăng nhập đã tồn tại nhưng không xác minh được tài khoản.");
    }

    const profileByIdUrl = new URL(`${config.url}/rest/v1/profiles`);
    profileByIdUrl.searchParams.set("id", `eq.${user.id}`);
    profileByIdUrl.searchParams.set("select", "id,username,class_id");
    const profileByIdResponse = await fetch(profileByIdUrl, { headers: supabaseHeaders(config.serviceKey) });
    const profilesById = await readJson(profileByIdResponse);
    if (!profileByIdResponse.ok) {
      throw supabaseRequestError(profileByIdResponse, profilesById, "Không thể xác minh hồ sơ Auth đã tồn tại.");
    }
    if (Array.isArray(profilesById) && profilesById.length) {
      throw new Error("Tên đăng nhập này đã được liên kết với một hồ sơ. Hãy xóa hoặc sửa tài khoản cũ trước.");
    }

    const updateResponse = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: "PUT",
      headers: supabaseHeaders(config.serviceKey),
      body: JSON.stringify({ password, email_confirm: true }),
    });
    const updatedUser = await readJson(updateResponse);
    if (!updateResponse.ok) {
      throw supabaseRequestError(updateResponse, updatedUser, "Không thể khôi phục tài khoản xác thực chưa có hồ sơ.");
    }
  }

  const profileResponse = await fetch(`${config.url}/rest/v1/profiles`, {
    method: "POST",
    headers: supabaseHeaders(config.serviceKey, { Prefer: "return=minimal" }),
    body: JSON.stringify({
      id: user.id,
      username,
      full_name: String(body.fullName || username).trim(),
      role,
      student_id: studentId,
      class_id: classId,
    }),
  });
  if (!profileResponse.ok) {
    const error = await readJson(profileResponse);
    if (createdAuthUser) {
      const deleteResponse = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        headers: supabaseHeaders(config.serviceKey),
      });
      if (!deleteResponse.ok) {
        const deleteError = await readJson(deleteResponse);
        throw new Error(`${supabaseErrorMessage(error, "Không thể lưu hồ sơ tài khoản.")} Không thể thu hồi tài khoản Auth tạm thời: ${supabaseErrorMessage(deleteError, "lỗi không xác định")}`);
      }
    }
    throw supabaseRequestError(profileResponse, error, "Không thể lưu hồ sơ tài khoản.");
  }

  if (role === "bcs" && studentRole) {
    linkedStudent.role = studentRole;
    const updateResponse = await fetch(
      `${config.url}/rest/v1/class_data?class_id=eq.${encodeURIComponent(classId)}`,
      {
        method: "PATCH",
        headers: supabaseHeaders(config.serviceKey, { Prefer: "return=minimal" }),
        body: JSON.stringify({ state: classState }),
      }
    );
    if (!updateResponse.ok) {
      await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
        headers: supabaseHeaders(config.serviceKey),
      });
      const error = await readJson(updateResponse);
      throw supabaseRequestError(updateResponse, error, "Không thể lưu vai trò cán bộ lớp.");
    }
  }

  return { id: user.id, username, fullName: String(body.fullName || username).trim(), role, studentId };
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    json(response, 405, { error: "Phương thức không được hỗ trợ." });
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    const missing = [];
    if (!url) missing.push("SUPABASE_URL (hoặc VITE_SUPABASE_URL)");
    if (!anonKey) missing.push("SUPABASE_ANON_KEY (hoặc VITE_SUPABASE_PUBLISHABLE_KEY)");
    if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY (hoặc SUPABASE_SECRET_KEY)");
    json(response, 503, {
      error: `Thiếu cấu hình server: ${missing.join(", ")}. Thêm trong Vercel → Settings → Environment Variables rồi redeploy.`,
    });
    return;
  }

  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    json(response, 401, { error: "Cần đăng nhập để thực hiện thao tác này." });
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

    const profileResponse = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=role,class_id`,
      { headers: supabaseHeaders(serviceKey) }
    );
    const profiles = await readJson(profileResponse);
    if (!profileResponse.ok) {
      throw supabaseRequestError(profileResponse, profiles, "Không thể xác minh quyền tài khoản.");
    }
    const actor = Array.isArray(profiles) ? profiles[0] : null;
    if (!actor || actor.role !== "gvcn") {
      json(response, 403, { error: "Chỉ GVCN mới được quản lý tài khoản." });
      return;
    }

    const body = request.body || {};
    const action = body.action || "create";
    if (action === "create") {
      const account = await handleCreate({ url, serviceKey }, body, actor.class_id);
      json(response, 201, { account });
      return;
    }

    const userId = String(body.userId || "");
    if (!userId || userId === authUser.id) {
      json(response, 400, { error: "Tài khoản mục tiêu không hợp lệ." });
      return;
    }
    const targetResponse = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,class_id,student_id`,
      { headers: supabaseHeaders(serviceKey) }
    );
    const targets = await readJson(targetResponse);
    const target = Array.isArray(targets) ? targets[0] : null;
    if (!targetResponse.ok) {
      throw supabaseRequestError(targetResponse, targets, "Không thể xác minh tài khoản mục tiêu.");
    }
    if (!target || target.class_id !== actor.class_id || target.role === "gvcn") {
      json(response, 403, { error: "Không được quản lý tài khoản này." });
      return;
    }

    if (action === "password") {
      const password = String(body.password || "");
      if (password.length < 6) throw new Error("Mật khẩu mới phải có ít nhất 6 ký tự.");
      const updateResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: supabaseHeaders(serviceKey),
        body: JSON.stringify({ password }),
      });
      const result = await readJson(updateResponse);
      if (!updateResponse.ok) throw supabaseRequestError(updateResponse, result, "Không thể đổi mật khẩu.");
      json(response, 200, { ok: true });
      return;
    }

    if (action === "delete") {
      let classState = null;
      let linkedStudent = null;
      let previousStudentRole = "";
      if (target.role === "bcs" && target.student_id) {
        const classDataUrl = new URL(`${url}/rest/v1/class_data`);
        classDataUrl.searchParams.set("class_id", `eq.${target.class_id}`);
        classDataUrl.searchParams.set("select", "state");
        const classDataResponse = await fetch(classDataUrl, { headers: supabaseHeaders(serviceKey) });
        const classRows = await readJson(classDataResponse);
        if (!classDataResponse.ok) {
          throw supabaseRequestError(classDataResponse, classRows, "Không thể tải dữ liệu lớp trước khi xóa tài khoản.");
        }
        classState = Array.isArray(classRows) && classRows[0] ? classRows[0].state : null;
        linkedStudent = classState && Array.isArray(classState.students)
          ? classState.students.find(student => String(student.id) === String(target.student_id))
          : null;
        const studentRole = String(linkedStudent && linkedStudent.role || "");
        const normalizedStudentRole = studentRole.toLocaleLowerCase("vi");
        if (linkedStudent && (normalizedStudentRole.includes("lớp trưởng") || normalizedStudentRole.includes("tổ trưởng"))) {
          previousStudentRole = linkedStudent.role;
          linkedStudent.role = "Thành viên";
          const roleUpdateResponse = await fetch(
            `${url}/rest/v1/class_data?class_id=eq.${encodeURIComponent(target.class_id)}`,
            {
              method: "PATCH",
              headers: supabaseHeaders(serviceKey, { Prefer: "return=minimal" }),
              body: JSON.stringify({ state: classState }),
            }
          );
          if (!roleUpdateResponse.ok) {
            const result = await readJson(roleUpdateResponse);
            throw supabaseRequestError(roleUpdateResponse, result, "Không thể gỡ vai trò cán bộ lớp trước khi xóa tài khoản.");
          }
        }
      }
      const attendanceUrl = new URL(`${url}/rest/v1/attendance_records`);
      attendanceUrl.searchParams.set("updated_by", `eq.${encodeURIComponent(userId)}`);
      const attendanceResponse = await fetch(attendanceUrl, {
        method: "PATCH",
        headers: supabaseHeaders(serviceKey, { Prefer: "return=minimal" }),
        body: JSON.stringify({ updated_by: null }),
      });
      if (!attendanceResponse.ok) {
        const result = await readJson(attendanceResponse);
        if (linkedStudent && previousStudentRole) {
          linkedStudent.role = previousStudentRole;
          const rollbackResponse = await fetch(
            `${url}/rest/v1/class_data?class_id=eq.${encodeURIComponent(target.class_id)}`,
            {
              method: "PATCH",
              headers: supabaseHeaders(serviceKey, { Prefer: "return=minimal" }),
              body: JSON.stringify({ state: classState }),
            }
          );
          if (!rollbackResponse.ok) {
            const rollbackError = await readJson(rollbackResponse);
            throw new Error(`${supabaseErrorMessage(result, "Không thể gỡ liên kết điểm danh của tài khoản.")} Không thể khôi phục vai trò cán bộ lớp: ${supabaseErrorMessage(rollbackError, "lỗi không xác định")}`);
          }
        }
        throw supabaseRequestError(attendanceResponse, result, "Không thể gỡ liên kết điểm danh của tài khoản.");
      }
      const deleteResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: supabaseHeaders(serviceKey),
      });
      if (!deleteResponse.ok) {
        const result = await readJson(deleteResponse);
        if (linkedStudent && previousStudentRole) {
          linkedStudent.role = previousStudentRole;
          const rollbackResponse = await fetch(
            `${url}/rest/v1/class_data?class_id=eq.${encodeURIComponent(target.class_id)}`,
            {
              method: "PATCH",
              headers: supabaseHeaders(serviceKey, { Prefer: "return=minimal" }),
              body: JSON.stringify({ state: classState }),
            }
          );
          if (!rollbackResponse.ok) {
            const rollbackError = await readJson(rollbackResponse);
            throw new Error(`${supabaseErrorMessage(result, "Không thể xóa tài khoản.")} Không thể khôi phục vai trò cán bộ lớp: ${supabaseErrorMessage(rollbackError, "lỗi không xác định")}`);
          }
        }
        throw supabaseRequestError(deleteResponse, result, "Không thể xóa tài khoản.");
      }
      json(response, 200, { ok: true });
      return;
    }

    json(response, 400, { error: "Thao tác không hợp lệ." });
  } catch (error) {
    json(response, 400, { error: error.message || "Yêu cầu không hợp lệ." });
  }
};
