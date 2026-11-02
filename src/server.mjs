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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathName = url.pathname.toLowerCase().replace(/\/$/, "");

  try {
    if (req.method === "GET" && pathName === "/admin") {
      const adminPath = path.join(process.cwd(), "public", "admin.html");
      if (fs.existsSync(adminPath)) return res.end(fs.readFileSync(adminPath));
      return send(res, 404, { error: "Dashboard file not found" });
    }

    // REMOVED ALL AUTHENTICATION - OPEN DOOR MODE
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

    if (req.method === "GET" && pathName === "/health") return send(res, 200, { status: "ok" });

    return send(res, 404, { error: "Not found" });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});
