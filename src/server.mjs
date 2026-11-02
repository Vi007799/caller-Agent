import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { builder, leads, properties, getLead, getProperty } from "./data.mjs";
import { createCallBrief, createInitialState } from "./agent.mjs";
import { generateTurn } from "./llm.mjs";
import { startOutboundCall } from "./telephony.mjs";
import { callBlockReason, normalizePhone } from "./calling-rules.mjs";
import { appendCallLog, loadCallLogs, saveOptOut, saveWebLead, saveLeadsFile, loadAgentScript, saveAgentScript } from
"./store.mjs";
import * as xlsx from "xlsx";
import * as pdf from "pdf-parse/node";

const port = Number(process.env.PORT || 3030);
const sessions = new Map();
const callLogs = loadCallLogs();

function send(res, code, data) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function readMultipart(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const boundary = req.headers["content-type"]?.split("boundary=")[1];
  if (!boundary) throw new Error("No boundary");
  const parts = raw.split("--" + boundary);
  const files = [];
  for (const p of parts) {
    if (p.includes("filename=")) {
      const m = p.match(/filename="([^"]+)"/);
      if (m) {
        const start = p.indexOf("\\r\\n\\r\\n") + 4;
        const end = p.lastIndexOf("\\r\\n");
        files.push({ name: m[1], data: Buffer.from(p.slice(start, end), "binary") });
      }
    }
  }
  return files;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathName = url.pathname.toLowerCase().replace(/\/$/, "");

  try {
    if (req.method === "GET" && pathName === "/admin") {
      const adminPath = path.join(process.cwd(), "public", "admin.html");
      if (fs.existsSync(adminPath)) return res.end(fs.readFileSync(adminPath));
      return send(res, 404, { error: "Dashboard file not found" });
    }

    if (req.method === "GET" && pathName === "/health") return send(res, 200, { status: "ok" });

    // SAFE-MATCH AUTHENTICATION
    if (pathName.startsWith("/api/admin") || pathName === "/api/dashboard" || pathName === "/api/leads") {
      const providedKey = (req.headers["x-admin-key"] || "").trim();
      const secretKey = (process.env.ADMIN_KEY || "").trim();

      if (!secretKey || providedKey !== secretKey) {
        return send(res, 401, { error: "Unauthorized" });
      }
    }

    if (pathName === "/api/dashboard") {
      return send(res, 200, {
        stats: { leads: leads.length, calls: callLogs.length, siteVisits: 0, callbacks: 0 },
        leads: leads.map(l => ({ id: l.id, fullName: l.fullName, phone: l.phone, interest: l.enquiry?.interest, optOut:
l.optOut }))
      });
    }

    if (req.method === "POST" && pathName === "/api/leads") {
      const body = await readJson(req);
      const items = Array.isArray(body.leads) ? body.leads : [body];
      const added = [];
      for (const item of items) {
        const lead = { id: "ld-"+Date.now()+Math.random(), fullName: item.name, phone: normalizePhone(item.phone),
enquiry: { interest: item.interest } };
        leads.push(lead);
        added.push(lead.id);
      }
      saveLeadsFile(leads);
      return send(res, 200, { added: added.length });
    }

    if (req.method === "POST" && pathName === "/api/leads/upload") {
      const files = await readMultipart(req);
      if (!files[0]) return send(res, 400, { error: "No file" });
      const f = files[0];
      let data = [];
      if (f.name.endsWith(".xlsx")) {
        const wb = xlsx.read(f.data, { type: "buffer" });
        data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      }
      data.forEach(d => leads.push({ id: "ld-"+Date.now()+Math.random(), fullName: d.name || d.FullName, phone:
normalizePhone(d.phone || d.Phone), enquiry: { interest: d.interest || "3 BHK" } }));
      saveLeadsFile(leads);
      return send(res, 200, { added: data.length });
    }

    if (req.method === "POST" && pathName === "/api/admin/script") {
      const { prompt } = await readJson(req);
      saveAgentScript({ prompt });
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathName === "/api/admin/script") {
      return send(res, 200, { script: loadAgentScript()?.prompt || "" });
    }

    return send(res, 404, { error: "Not found" });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

server.listen(port, () => console.log("Server running on " + port));
