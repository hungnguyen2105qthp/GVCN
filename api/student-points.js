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

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    json(response, 405, { error: "Phương thức không được hỗ trợ." });
    return;
  }

  const rawUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !anonKey || !serviceKey) {
    json(response, 503, { error: "Máy chủ chưa được cấu hình đầy đủ Supabase." });
    return;
  }

  const url = rawUrl.replace(/\/+$/, "");
  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    json(response, 401, { error: "Cần đăng nhập để trừ điểm." });
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
    profileUrl.searchParams.set("select", "id,role,class_id,student_id,full_name");
    const profileResponse = await fetch(profileUrl, { headers: supabaseHeaders(serviceKey) });
    const profiles = await readJson(profileResponse);
    if (!profileResponse.ok) throw new Error("Không thể xác minh tài khoản cán bộ lớp.");
    const actor = Array.isArray(profiles) ? profiles[0] : null;
    if (!actor || actor.role !== "bcs" || !actor.student_id) {
      json(response, 403, { error: "Chỉ tài khoản cán bộ lớp mới được trừ điểm." });
      return;
    }

    const body = request.body || {};
    const studentId = String(body.studentId || "").trim();
    const points = Number(body.points);
    const reason = String(body.reason || "").trim();
    const category = String(body.category || "Kỷ luật").trim();
    if (!studentId || !Number.isInteger(points) || points < 1 || points > 500 || reason.length < 2 || reason.length > 300 || category.length > 50) {
      json(response, 400, { error: "Điểm phải từ 1 đến 500; lý do từ 2 đến 300 ký tự." });
      return;
    }

    const classDataUrl = new URL(`${url}/rest/v1/class_data`);
    classDataUrl.searchParams.set("class_id", `eq.${actor.class_id}`);
    classDataUrl.searchParams.set("select", "state");
    const classResponse = await fetch(classDataUrl, { headers: supabaseHeaders(serviceKey) });
    const classRows = await readJson(classResponse);
    if (!classResponse.ok) throw new Error("Không thể tải dữ liệu lớp.");
    const classState = Array.isArray(classRows) && classRows[0] ? classRows[0].state : null;
    const students = classState && Array.isArray(classState.students) ? classState.students : [];
    const sender = students.find(student => String(student.id) === String(actor.student_id));
    const student = students.find(item => String(item.id) === studentId);
    const senderRole = String(sender && sender.role || "").trim().toLocaleLowerCase("vi");
    const isClassLeader = senderRole.includes("lớp trưởng");
    const isGroupLeader = senderRole.includes("tổ trưởng");
    if (!sender || (!isClassLeader && !isGroupLeader)) {
      json(response, 403, { error: "Chỉ lớp trưởng hoặc tổ trưởng mới được trừ điểm." });
      return;
    }
    if (!student) {
      json(response, 404, { error: "Không tìm thấy học sinh trong lớp." });
      return;
    }
    if (!isClassLeader && (!String(sender.group || "").trim() ||
      String(sender.group).trim() !== String(student.group || "").trim())) {
      json(response, 403, { error: "Tổ trưởng chỉ được trừ điểm thành viên trong tổ của mình." });
      return;
    }

    const now = new Date().toISOString();
    const pointsToApply = -points;
    student.points = (Number(student.points) || 0) + pointsToApply;
    student.stars = Math.max(0, (Number(student.stars) || 0) + pointsToApply);
    if (!Array.isArray(student.history)) student.history = [];
    student.history.push({
      id: `bcs-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      date: now,
      points: pointsToApply,
      reason: `${reason} [${category}]`,
      performedBy: actor.full_name || "Ban Cán Sự",
      performedByRole: "bcs",
    });

    const updateUrl = new URL(`${url}/rest/v1/class_data`);
    updateUrl.searchParams.set("class_id", `eq.${actor.class_id}`);
    const updateResponse = await fetch(updateUrl, {
      method: "PATCH",
      headers: supabaseHeaders(serviceKey, { Prefer: "return=representation" }),
      body: JSON.stringify({ state: classState }),
    });
    const updatedRows = await readJson(updateResponse);
    if (!updateResponse.ok) throw new Error("Không thể lưu điểm lên dữ liệu lớp.");
    if (!Array.isArray(updatedRows) || !updatedRows.length) {
      throw new Error("Không tìm thấy dữ liệu lớp để lưu điểm.");
    }
    json(response, 200, { student });
  } catch (error) {
    console.error("Không thể lưu thao tác trừ điểm cán bộ lớp:", error);
    json(response, 500, { error: error.message || "Không thể lưu điểm." });
  }
};
