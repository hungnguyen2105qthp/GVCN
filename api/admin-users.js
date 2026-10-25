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

  if (!/^[a-z0-9._-]{2,64}$/.test(username) || password.length < 6 || !role || !studentId) {
    throw new Error("Tài khoản, mật khẩu từ 6 ký tự, vai trò và học sinh liên kết là bắt buộc.");
  }

  const localPart = Array.from(encoder.encode(username.toLowerCase()), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const email = `u.${localPart}@accounts.example.com`;
  const createResponse = await fetch(`${config.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: supabaseHeaders(config.serviceKey),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await readJson(createResponse);
  if (!createResponse.ok) throw supabaseRequestError(createResponse, user, "Không thể tạo tài khoản xác thực.");

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
    await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: "DELETE",
      headers: supabaseHeaders(config.serviceKey),
    });
    const error = await readJson(profileResponse);
    throw supabaseRequestError(profileResponse, error, "Không thể lưu hồ sơ tài khoản.");
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
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,class_id`,
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
      const deleteResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: supabaseHeaders(serviceKey),
      });
      if (!deleteResponse.ok) {
        const result = await readJson(deleteResponse);
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
