import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { builder, leads, properties, getLead, getProperty } from "./data.mjs";
import { createCallBrief, createInitialState } from "./agent.mjs";
import { generateTurn } from "./llm.mjs";
import { startOutboundCall } from "./telephony.mjs";
import { callBlockReason, normalizePhone } from "./calling-rules.mjs";
import { appendCallLog, loadCallLogs, saveOptOut, saveWebLead, saveLeadsFile, loadAgentScript,
saveAgentScript } from "./store.mjs";
import * as xlsx from "xlsx";
import * as pdf from "pdf-parse/node";

const port = Number(process.env.PORT || 3030);
const sessions = new Map();
const callLogs = loadCallLogs();

function logEvent(record) {
  const entry = { at: new Date().toISOString(), ...record };
  callLogs.push(entry);
  appendCallLog(entry);
  return entry;
}

function applyOptOut(lead) {
  lead.optOut = true;
  saveOptOut(lead.id);
}

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
  const url = new URL(req.url, "http://localhost");
  try {
    // Bulletproof Admin Route
    const pathName = url.pathname.toLowerCase().replace(/\/$/, "");
    if (req.method === "GET" && pathName === "/admin") {
      const adminPath = path.join(process.cwd(), "public", "admin.html");
      if (fs.existsSync(adminPath)) {
        return res.end(fs.readFileSync(adminPath));
      } else {
        return send(res, 404, {
          error: "File missing on disk",
          searchedAt: adminPath,
          currentDir: process.cwd()
        });
      }
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { status: "ok" });
    }
    if (url.pathname.startsWith("/api/admin") && req.headers["x-admin-key"] !== process.env.ADMIN_KEY) {
      return send(res, 401, { error: "Unauthorized" });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/leads/update") {
      const { leadId, updates } = await readJson(req);
      const l = getLead(leadId);
      if (!l) return send(res, 404, { error: "Not found" });
      Object.assign(l, updates);
      saveLeadsFile(leads);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/leads/upload") {
      const files = await readMultipart(req);
      if (!files[0]) return send(res, 400, { error: "No file" });
      const f = files[0];
      let data = [];
      if (f.name.endsWith(".xlsx")) {
        const wb = xlsx.read(f.data, { type: "buffer" });
        data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      }
      return send(res, 200, { added: data.length });
    }
    // Simple routing for other API calls
    if (url.pathname === "/api/leads") return send(res, 200, { leads });

    return send(res, 404, { error: "Not found" });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

setInterval(async () => {
  const now = new Date();
  const due = leads.filter(l => l.nextCallTime && new Date(l.nextCallTime) <= now);
  for (const l of due) {
    try {
      await startOutboundCall({ lead: l, property: properties[0] });
      l.nextCallTime = null;
      saveLeadsFile(leads);
    } catch (e) {}
  }
}, 60000);

server.listen(port, () => console.log("Live on " + port));
