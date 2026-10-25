const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = process.cwd();
const apiHandlers = {
  "/api/config": require("../api/config"),
  "/api/admin-users": require("../api/admin-users"),
  "/api/reminders": require("../api/reminders"),
};
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function loadLocalEnvironment() {
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(root, fileName);
    if (!fs.existsSync(filePath)) continue;

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Nội dung yêu cầu vượt quá giới hạn 1 MB."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Nội dung JSON không hợp lệ."));
      }
    });
    request.on("error", reject);
  });
}

async function handleApi(request, response, pathname) {
  const handler = apiHandlers[pathname];
  if (!handler) {
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Không tìm thấy API." }));
    return;
  }

  if (["POST", "PUT"].includes(request.method)) {
    try {
      request.body = await readJsonBody(request);
    } catch (error) {
      if (!response.destroyed) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
  }

  await handler(request, {
    setHeader: response.setHeader.bind(response),
    status(code) {
      response.statusCode = code;
      return this;
    },
    json(body) {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify(body));
      return this;
    },
  });
}

loadLocalEnvironment();

const port = Number(process.env.PORT || 8000);

http
  .createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      response.writeHead(400).end("Yêu cầu không hợp lệ.");
      return;
    }

    if (pathname.startsWith("/api/")) {
      handleApi(request, response, pathname).catch(error => {
        console.error("Local API error:", error);
        if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        if (!response.destroyed) response.end(JSON.stringify({ error: "Lỗi máy chủ cục bộ." }));
      });
      return;
    }

    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }

    fs.readFile(file, (error, data) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
        return;
      }

      response.writeHead(200, {
        "Content-Type": mimeTypes[path.extname(file)] || "application/octet-stream",
      });
      response.end(data);
    });
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`GVCN local server: http://127.0.0.1:${port}`);
  });
