const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

function loadLocalEnvironment() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.resolve(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) continue;

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

function promptLine(question, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    terminal.question(`${question}${suffix}: `, answer => {
      terminal.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

function promptSecret(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Chạy lệnh này trong terminal tương tác để nhập bí mật an toàn.");
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdout.write(`${question}: `);

  return new Promise((resolve, reject) => {
    let value = "";
    const onKeypress = (character, key) => {
      if (key && (key.name === "return" || key.name === "enter")) {
        process.stdin.off("keypress", onKeypress);
        process.stdin.setRawMode(false);
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (key && key.ctrl && key.name === "c") {
        process.stdin.off("keypress", onKeypress);
        process.stdin.setRawMode(false);
        process.stdout.write("\n");
        reject(new Error("Đã hủy thao tác."));
        return;
      }
      if (key && key.name === "backspace") {
        if (value.length) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }
      if (!key || !key.ctrl && !key.meta) {
        value += character;
        process.stdout.write("*");
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}

function responseMessage(body, fallback) {
  return body && (body.msg || body.message || body.error_description || body.error) || fallback;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { response, body };
}

async function main() {
  loadLocalEnvironment();
  const projectUrl = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!projectUrl) throw new Error("Thiếu SUPABASE_URL. Hãy điền URL trong .env.local hoặc biến môi trường.");

  const username = (await promptLine("Tên đăng nhập GVCN", "gvcn")).toLowerCase();
  if (!/^[a-z0-9._-]{2,64}$/.test(username)) {
    throw new Error("Tên đăng nhập chỉ được gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang (2-64 ký tự).");
  }
  const fullName = await promptLine("Họ tên hiển thị", "Giáo viên chủ nhiệm");
  const classId = await promptLine("Mã lớp", "12C1");
  if (!classId) throw new Error("Mã lớp không được để trống.");

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ||
    await promptSecret("Nhập Supabase service_role/secret key");
  if (!serviceKey) throw new Error("Service-role key không được để trống.");
  const password = await promptSecret("Tạo mật khẩu GVCN (ít nhất 6 ký tự)");
  if (password.length < 6) throw new Error("Mật khẩu cần có ít nhất 6 ký tự.");
  const confirmation = await promptSecret("Nhập lại mật khẩu");
  if (password !== confirmation) throw new Error("Hai mật khẩu không khớp.");

  const usernameBytes = new TextEncoder().encode(username);
  const localPart = Array.from(usernameBytes, byte => byte.toString(16).padStart(2, "0")).join("");
  const email = `u.${localPart}@accounts.example.com`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  const { response: createResponse, body: user } = await requestJson(`${projectUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!createResponse.ok || !user || !user.id) {
    throw new Error(responseMessage(user, "Không tạo được Auth user. Kiểm tra service-role key và trạng thái tài khoản."));
  }

  const { response: profileResponse, body: profileError } = await requestJson(`${projectUrl}/rest/v1/profiles`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      id: user.id,
      username,
      full_name: fullName,
      role: "gvcn",
      student_id: null,
      class_id: classId,
    }),
  });
  if (!profileResponse.ok) {
    const { response: rollbackResponse } = await requestJson(
      `${projectUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
      { method: "DELETE", headers }
    );
    const detail = responseMessage(profileError, "Không lưu được hồ sơ GVCN.");
    if (!rollbackResponse.ok) {
      throw new Error(`${detail} Không thể tự xóa Auth user vừa tạo; hãy xóa user ${user.id} trong Supabase Dashboard.`);
    }
    throw new Error(`${detail} Auth user vừa tạo đã được xóa để tránh tài khoản dở dang.`);
  }

  console.log(`Đã tạo tài khoản GVCN "${username}" cho lớp ${classId}.`);
  console.log(`Email đăng nhập nội bộ: ${email}`);
  console.log("Hãy đăng nhập ứng dụng bằng username và mật khẩu vừa tạo.");
}

main().catch(error => {
  console.error(`Không thể tạo tài khoản GVCN: ${error.message}`);
  process.exitCode = 1;
});
