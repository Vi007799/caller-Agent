import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.env.PORT || 3030);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === "GET" && url.pathname === "/admin") {
    try {
      const adminPath = path.join(process.cwd(), "public", "admin.html");
      if (fs.existsSync(adminPath)) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(fs.readFileSync(adminPath));
      }
    } catch (e) {
      console.error("File error:", e);
    }
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ status: "ok" }));
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, () => {
  console.log("Minimum Server running on port " + port);
