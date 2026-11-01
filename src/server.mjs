import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { builder, leads, properties, getLead, getProperty } from "./data.mjs";
import { createCallBrief, createInitialState } from "./agent.mjs";
import { generateTurn } from "./llm.mjs";
import { startOutboundCall } from "./telephony.mjs";
import { callBlockReason, normalizePhone } from "./calling-rules.mjs";
import { appendCallLog, loadCallLogs, saveOptOut, saveWebLead, saveLeadsFile, loadAgentScript, saveAgentScript } from "./store.mjs";
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

function send(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

// ... existing code ...
async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 100000) throw new Error("Request body is too large.");
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function readMultipart(request) {
  // Simple multipart parser for lead uploads
  // In a production app, use 'busboy' or 'multer'
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
  }
  const boundary = request.headers["content-type"]?.split("boundary=")[1];
  if (!boundary) throw new Error("No boundary found in content-type.");

  const parts = raw.split("--" + boundary);
  const files = [];
  for (const part of parts) {
    if (part.includes("filename=")) {
      const match = part.match(/filename="([^"]+)"/);
      if (match) {
        const contentStart = part.indexOf("\\r\\n\\r\\n") + 4;
        const contentEnd = part.lastIndexOf("\\r\\n");
        files.push({
          name: match[1],
          data: Buffer.from(part.slice(contentStart, contentEnd), "binary")
        });
      }
    }
  }
  return files;
}

function requestedProperty(lead, propertyId) {
// ... existing code ...
  return getProperty(propertyId || lead.enquiry.propertyId);
}

function checkLead(lead) {
  if (!lead) return "Lead not found.";
  if (!lead.consentToCall) return "This lead has not consented to calls.";
  if (lead.optOut) return "This lead is marked do not call.";
  return null;
}

function publicLead(lead) {
  return {
    id: lead.id,
    fullName: lead.fullName,
    preferredLanguage: lead.preferredLanguage,
    consentToCall: lead.consentToCall,
    optOut: lead.optOut,
    enquiry: lead.enquiry
  };
}

function publicProperty(property) {
  return {
    id: property.id,
    name: property.name,
    location: property.location,
    configurations: property.configurations,
    priceRange: property.priceRange,
    highlights: property.highlights,
    visitSlots: property.visitSlots
  };
}

function sessionFor(lead, property, requestedSessionId) {
  const id = requestedSessionId || lead.id + ":" + property.id;
  if (!sessions.has(id)) sessions.set(id, createInitialState());
  return { id, state: sessions.get(id) };
}


const OUTCOME_LABELS = {
  opt_out: "Asked not to be called again",
  site_visit: "Wants a site visit",
  callback: "Wants a sales advisor callback",
  talked: "Spoke, no action yet",
  no_answer: "No answer",
  voicemail: "Voicemail",
  failed: "Call failed",
  in_progress: "In progress"
};

function callSummaries() {
  const calls = new Map();
  for (const e of callLogs) {
    if (!e.callId) continue;
    const c = calls.get(e.callId) || { callId: e.callId, leadId: e.leadId, events: [] };
    c.events.push(e);
    if (e.event === "call_started") c.startedAt = e.at;
    if (e.event === "call_ended") Object.assign(c, { endedAt: e.at, endedReason: e.endedReason, durationSeconds: e.durationSeconds, summary: e.summary, transcript: e.transcript });
    calls.set(e.callId, c);
  }
  return [...calls.values()].map((c) => {
    const has = (name) => c.events.some((e) => e.event === name);
    const reason = String(c.endedReason || "");
    let outcome = "talked";
    if (has("opt_out")) outcome = "opt_out";
    else if (has("site_visit_requested")) outcome = "site_visit";
    else if (has("human_callback_requested")) outcome = "callback";
    else if (!c.endedAt) outcome = "in_progress";
    else if (/voicemail/i.test(reason)) outcome = "voicemail";
    else if (/no-answer|did-not-answer|busy/i.test(reason) || (c.durationSeconds || 0) < 8) outcome = "no_answer";
    else if (/error|failed|fail/i.test(reason)) outcome = "failed";
    const lead = getLead(c.leadId);
    const visit = c.events.find((e) => e.event === "site_visit_requested");
    const callback = c.events.find((e) => e.event === "human_callback_requested");
    return {
      callId: c.callId, leadId: c.leadId, leadName: lead?.fullName || "Unknown", phone: lead?.phone || "",
      startedAt: c.startedAt, durationSeconds: c.durationSeconds, endedReason: c.endedReason,
      outcome, outcomeLabel: OUTCOME_LABELS[outcome], summary: c.summary || "",
      preferredVisitTime: visit?.preferredTime || null, callbackReason: callback?.reason || null,
      transcript: c.transcript || ""
    };
  }).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

// ... existing code ...
function dashboardData() {
  const calls = callSummaries();
  const lastByLead = new Map();
  for (const c of [...calls].reverse()) lastByLead.set(c.leadId, c);
  const rows = leads.filter((l) => l.id !== "web-visitor").map((l) => {
    const blocked = callBlockReason(l, { callLogs });
    const last = lastByLead.get(l.id);
    return {
      id: l.id, fullName: l.fullName, phone: l.phone, source: l.source || "manual",
      interest: l.enquiry?.interest, budget: l.enquiry?.budget || null,
      optOut: !!l.optOut, dndChecked: l.dndChecked === true,
      canCall: !blocked, blockedReason: blocked,
      lastOutcome: last ? last.outcomeLabel : null,
      nextCallTime: l.nextCallTime || null
    };
  });
  const count = (o) => calls.filter((c) => c.outcome === o).length;
  return {
// ... existing code ...
    builder: builder.name,
    liveCalling: process.env.OUTBOUND_CALLING_ENABLED === "true",
    stats: {
      leads: rows.length, calls: calls.length,
      siteVisits: count("site_visit"), callbacks: count("callback"),
      optOuts: rows.filter((r) => r.optOut).length, noAnswer: count("no_answer") + count("voicemail")
    },
    leads: rows,
    calls
  };
}

function addLeads(items, attested) {
  const added = [], skipped = [];
  for (const item of items) {
    const phone = normalizePhone(item.phone);
    const name = String(item.name || "").trim().slice(0, 80);

    // Strict Validation
    if (!name || name.length < 2) {
      skipped.push({ name: item.name || "(blank)", reason: "Name is too short or missing." });
      continue;
    }
    if (!phone || !/^\d{10,15}$/.test(phone)) {
      skipped.push({ name, reason: "Invalid phone number. Must be 10-15 digits." });
      continue;
    }

    if (leads.some((l) => l.phone && normalizePhone(l.phone) === phone)) {
      skipped.push({ name, reason: "Number already added." });
      continue;
    }
    const lead = {
      id: "ld-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      fullName: name, firstName: name.split(" ")[0], phone,
      preferredLanguage: /english/i.test(item.language || "") ? "english" : "hinglish",
      consentToCall: attested === true, dndChecked: attested === true, optOut: false, source: "dashboard",
      enquiry: { propertyId: properties[0].id, interest: String(item.interest || "3 BHK").slice(0, 40), budget: item.budget ? String(item.budget).slice(0, 40) : null }
    };
    leads.push(lead); saveWebLead(lead); added.push(lead.id);
  }
  return { added: added.length, skipped };
}

const publicDir = path.resolve("./public");
const webHits = new Map();

function isAdmin(request) {
  const key = process.env.ADMIN_KEY;
  if (!key) return !process.env.PUBLIC_BASE_URL; // no key: only allowed while running locally
  return request.headers["x-admin-key"] === key;
}

function tooManyEnquiries(ip) {
  const now = Date.now();
  const hits = (webHits.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  hits.push(now);
  webHits.set(ip, hits);
  return hits.length > 5;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost:" + port);

  try {
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const file = path.join(publicDir, "index.html");
      if (!fs.existsSync(file)) return send(response, 404, { error: "public/index.html not found." });
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(fs.readFileSync(file));
    }

    const adminOnly = url.pathname.startsWith("/api/leads") || url.pathname.startsWith("/api/calls/") || url.pathname === "/api/dashboard";
    if (adminOnly && !isAdmin(request)) {
      return send(response, 401, { error: "Admin access required. Set ADMIN_KEY and send it as the x-admin-key header." });
    }

    if (request.method === "GET" && url.pathname === "/admin") {
      const file = path.join(publicDir, "admin.html");
      if (!fs.existsSync(file)) return send(response, 404, { error: "public/admin.html not found." });
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(fs.readFileSync(file));
    }

    if (request.method === "GET" && url.pathname === "/api/admin/script") {
      return send(response, 200, { script: loadAgentScript()?.prompt || "No script defined." });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/script") {
      const body = await readJson(request);
      if (!body.prompt) return send(response, 400, { error: "Prompt is required." });
      saveAgentScript({ prompt: body.prompt });
      return send(response, 200, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/run-wave") {
      const body = await readJson(request);
      const waveType = body.waveType;
      if (!waveType) return send(response, 400, { error: "waveType is required." });

      const now = new Date();
      const eligibleLeads = leads.filter((l) => {
        if (l.optOut) return false;

        const lastCall = callLogs.filter(log => log.leadId === l.id).sort((a, b) => new Date(b.at) - new Date(a.at))[0];
        const lastOutcome = lastCall?.disposition || "none";

        switch (waveType) {
          case "scheduled":
            return l.nextCallTime && new Date(l.nextCallTime) <= now;
          case "callback_requested":
            return lastOutcome === "callback_requested";
          case "no_response":
            return lastOutcome === "no_answer" || lastOutcome === "voicemail";
          case "all_eligible":
            return true;
          default:
            return false;
        }
      });

      const results = [];
      for (const lead of eligibleLeads) {
        const property = requestedProperty(lead);
        if (!property) continue;
        const outbound = await startOutboundCall({ lead, property });
        if (outbound.statusCode === 202) {
          logEvent({ event: "call_started", leadId: lead.id, propertyId: property.id, callId: outbound.body.callId });
          results.push({ leadId: lead.id, status: "started" });
        } else {
          results.push({ leadId: lead.id, status: "failed" });
        }
      }
      return send(response, 200, { wave: waveType, results });
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/leads/")) {
      const leadId = url.pathname.split("/").pop();
      const index = leads.findIndex(l => l.id === leadId);
      if (index === -1) return send(response, 404, { error: "Lead not found." });

      leads.splice(index, 1);
      saveLeadsFile(leads);
      return send(response, 200, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/leads/update") {
      const body = await readJson(request);
      const { leadId, updates } = body;
      if (!leadId) return send(response, 400, { error: "leadId is required." });

      const lead = getLead(leadId);
      if (!lead) return send(response, 404, { error: "Lead not found." });

      if (updates.fullName) lead.fullName = String(updates.fullName).trim();
      if (updates.phone) {
        const normalized = normalizePhone(updates.phone);
        if (!/^\d{10,15}$/.test(normalized)) return send(response, 400, { error: "Invalid phone format." });
        lead.phone = normalized;
      }
      if (updates.interest) lead.enquiry.interest = String(updates.interest).trim();
      if (updates.budget) lead.enquiry.budget = String(updates.budget).trim();

      saveLeadsFile(leads);
      return send(response, 200, { ok: true, lead });
    }

// ... existing code ...
    if (request.method === "POST" && url.pathname === "/api/leads") {
      const body = await readJson(request);
      if (body.consentConfirmed !== true) {
        return send(response, 400, { error: "Confirm that these leads have consented to calls and were checked against DND before adding them." });
      }
      const items = Array.isArray(body.leads) ? body.leads.slice(0, 500) : [];
      const added = addLeads(items, true);
      saveLeadsFile(leads);
      return send(response, 200, added);
    }

    if (request.method === "POST" && url.pathname === "/api/leads/upload") {
      try {
        const files = await readMultipart(request);
        if (files.length === 0) return send(response, 400, { error: "No file uploaded." });
        const file = files[0];
        let leadData = [];

        if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
          const workbook = xlsx.read(file.data, { type: "buffer" });
          const sheetName = workbook.SheetNames[0];
          leadData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
        } else if (file.name.endsWith(".pdf")) {
          const pdfData = await pdf(file.data);
          const text = pdfData.text;

          // Improved PDF extraction: try to find patterns of Name, Phone, Interest
          const lines = text.split("\n").filter(l => l.trim());
          leadData = lines.map(line => {
            const parts = line.split(/[,|]/);
            return {
              name: parts[0]?.trim(),
              phone: parts[1]?.trim(),
              interest: parts[2]?.trim() || "3 BHK",
              language: "hinglish"
            };
          });
        } else {
          return send(response, 400, { error: "Unsupported file format. Use .xlsx or .pdf" });
        }

        const items = leadData.map(d => ({
          name: d.name || d.FullName || d.CustomerName || "Unknown",
          phone: d.phone || d.Phone || d.Mobile || "",
          language: d.language || "hinglish",
          interest: d.interest || d.Interest || d.Enquiry || "3 BHK",
          budget: d.budget || d.Budget || null
        }));

        return send(response, 200, addLeads(items, true));
      } catch (err) {
        return send(response, 500, { error: "Upload failed: " + err.message });
      }
    }

    if (request.method === "POST" && url.pathname === "/api/leads/optout") {
// ... existing code ...
      const body = await readJson(request);
      const lead = getLead(body.leadId);
      if (!lead) return send(response, 404, { error: "Lead not found." });
      applyOptOut(lead);
      logEvent({ event: "manual_opt_out", leadId: lead.id });
      return send(response, 200, { ok: true });
    }

    // Website visitor chat (anonymous, no phone call involved).
    if (request.method === "POST" && url.pathname === "/api/web/chat") {
      const body = await readJson(request);
      const property = properties[0];
      const visitor = { id: "web-visitor", firstName: "there", fullName: "Website visitor", preferredLanguage: "hinglish", consentToCall: true, optOut: false, enquiry: { propertyId: property.id, interest: "a home" } };
      const id = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : "web:" + Math.random().toString(36).slice(2);
      if (!sessions.has(id)) sessions.set(id, { ...createInitialState(), opened: true });
      const state = sessions.get(id);
      const message = String(body.message || "").slice(0, 500);
      const result = await generateTurn(visitor, property, message, state);
      state.transcript.push({ role: "lead", text: message }, { role: "agent", text: result.turn.spokenText });
      state.disposition = result.turn.disposition;
      return send(response, 200, {
        sessionId: id,
        reply: result.turn.spokenText,
        intent: result.turn.intent,
        handoff: result.turn.handoffRequired === true
      });
    }

    // Website visitor asks for a call. Consent checkbox is mandatory.
    if (request.method === "POST" && url.pathname === "/api/web/enquiry") {
      const ip = String(request.headers["x-forwarded-for"] || request.socket.remoteAddress).split(",")[0].trim();
      if (tooManyEnquiries(ip)) return send(response, 429, { message: "Too many requests. Please try again later." });
      const body = await readJson(request);
      const phone = normalizePhone(body.phone);
      const name = String(body.name || "").trim().slice(0, 80);
      if (!name || !phone) return send(response, 400, { message: "Please enter your name and a valid mobile number." });
      if (body.consent !== true) return send(response, 400, { message: "Please tick the consent box so we can call you." });
      const property = properties[0];
      const interest = body.interest === "4 BHK" ? "4 BHK" : "3 BHK";
      const lead = {
        id: "web-" + Date.now().toString(36),
        fullName: name,
        firstName: name.split(" ")[0],
        phone,
        preferredLanguage: "hinglish",
        consentToCall: true,
        dndChecked: process.env.WEB_LEADS_DND_CLEARED === "true",
        optOut: false,
        source: "website",
        enquiry: { propertyId: property.id, interest, budget: null }
      };
      leads.push(lead);
      saveWebLead(lead);
      logEvent({ event: "web_enquiry", leadId: lead.id });
      const blocked = callBlockReason(lead, { callLogs });
      if (blocked) {
        return send(response, 200, { message: "Thank you, " + lead.firstName + "! Our team will call you during calling hours (10 am to 7 pm)." });
      }
      const outbound = await startOutboundCall({ lead, property });
      if (outbound.statusCode === 202) {
        logEvent({ event: "call_started", leadId: lead.id, propertyId: property.id, callId: outbound.body.callId });
        return send(response, 200, { message: "Thank you, " + lead.firstName + "! Our advisor is calling you now." });
      }
      return send(response, 200, { message: "Thank you, " + lead.firstName + "! We have your request and our team will call you shortly." });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return send(response, 200, {
        status: "ok",
        builder: builder.name,
        liveCallingEnabled: process.env.OUTBOUND_CALLING_ENABLED === "true",
        configuredProvider: process.env.LLM_PROVIDER || "rule-based"
      });
    }

    if (request.method === "GET" && url.pathname === "/api/properties") {
      return send(response, 200, { properties: properties.map(publicProperty) });
    }

    if (request.method === "GET" && url.pathname === "/api/leads") {
      return send(response, 200, { leads: leads.map(publicLead) });
    }

    if (request.method === "GET" && url.pathname === "/api/calls/logs") {
      return send(response, 200, { calls: callLogs });
    }

    if (request.method === "POST" && url.pathname === "/api/calls/preview") {
      const body = await readJson(request);
      const lead = getLead(body.leadId);
      const error = checkLead(lead);
      if (error) return send(response, 409, { error });
      const property = requestedProperty(lead, body.propertyId);
      if (!property) return send(response, 404, { error: "Property not found." });
      return send(response, 200, {
        callBrief: createCallBrief(lead, property),
        lead: publicLead(lead),
        property: publicProperty(property)
      });
    }

// ... existing code ...
    if (request.method === "POST" && url.pathname === "/api/calls/turn") {
      const body = await readJson(request);
      const lead = getLead(body.leadId);
      const error = checkLead(lead);
      if (error) return send(response, 409, { error });
      const property = requestedProperty(lead, body.propertyId);
      if (!property) return send(response, 404, { error: "Property not found." });

      const session = sessionFor(lead, property, body.sessionId);
      const callerSaid = typeof body.callerSaid === "string" ? body.callerSaid : "";
      const result = await generateTurn(lead, property, callerSaid, session.state);

      if (callerSaid) session.state.transcript.push({ role: "lead", text: callerSaid });
      session.state.transcript.push({ role: "agent", text: result.turn.spokenText });
      session.state.disposition = result.turn.disposition;

      if (result.turn.disposition === "opt_out" || result.turn.captured.optOut === true) {
        applyOptOut(lead);
      }

      if (result.turn.disposition === "callback_requested" || result.turn.captured.callbackTime) {
        const time = result.turn.captured.callbackTime || "tomorrow";
        const nextCall = new Date();
        if (time === "tomorrow") nextCall.setDate(nextCall.getDate() + 1);
        else nextCall.setHours(11, 0, 0, 0); // Default to 11 AM
        lead.nextCallTime = nextCall.toISOString();
        logEvent({ event: "callback_scheduled", leadId: lead.id, nextCallTime: lead.nextCallTime });
      }

      const record = {
        at: new Date().toISOString(),
        sessionId: session.id,
        leadId: lead.id,
        propertyId: property.id,
        intent: result.turn.intent,
        disposition: result.turn.disposition,
        nextAction: result.turn.nextAction
      };
      callLogs.push(record);

      return send(response, 200, {
        sessionId: session.id,
        provider: result.provider,
        fallbackReason: result.fallbackReason,
        agent: result.turn,
        leadStatus: { optOut: lead.optOut },
        log: record
      });
    }
// ... existing code ...

    if (request.method === "POST" && url.pathname === "/api/calls/start") {
      const body = await readJson(request);
      const lead = getLead(body.leadId);
      const blocked = callBlockReason(lead, { callLogs });
      if (blocked) return send(response, 409, { error: blocked });
      const property = requestedProperty(lead, body.propertyId);
      if (!property) return send(response, 404, { error: "Property not found." });
      const outbound = await startOutboundCall({ lead, property });
      if (outbound.statusCode === 202) {
        logEvent({ event: "call_started", leadId: lead.id, propertyId: property.id, callId: outbound.body.callId });
      }
      return send(response, outbound.statusCode, outbound.body);
    }

    // Calls every eligible lead one after another. Requires {"confirm": true}.
    if (request.method === "POST" && url.pathname === "/api/calls/start-all") {
      const body = await readJson(request);
      if (body.confirm !== true) return send(response, 400, { error: 'Send {"confirm": true} to start calling all eligible leads.' });
      const gapMs = Number(process.env.SECONDS_BETWEEN_CALLS || 30) * 1000;
      const limit = Number(body.limit || 20);
      const results = [];
      for (const lead of leads) {
        if (results.filter((r) => r.status === "call_started").length >= limit) break;
        const blocked = callBlockReason(lead, { callLogs });
        if (blocked) { results.push({ leadId: lead.id, status: "skipped", reason: blocked }); continue; }
        const property = requestedProperty(lead);
        if (!property) { results.push({ leadId: lead.id, status: "skipped", reason: "Property not found." }); continue; }
        const outbound = await startOutboundCall({ lead, property });
        if (outbound.statusCode === 202) {
          logEvent({ event: "call_started", leadId: lead.id, propertyId: property.id, callId: outbound.body.callId });
          results.push({ leadId: lead.id, status: "call_started", callId: outbound.body.callId });
          await new Promise((r) => setTimeout(r, gapMs));
        } else {
          results.push({ leadId: lead.id, status: "failed", detail: outbound.body });
          if (outbound.statusCode === 409 || outbound.statusCode === 500) break;
        }
      }
      return send(response, 200, { results });
    }

    // Vapi sends tool calls and end-of-call reports here.
    if (request.method === "POST" && url.pathname === "/api/vapi/webhook") {
      const secret = process.env.WEBHOOK_SECRET;
      if (secret && request.headers["x-vapi-secret"] !== secret) return send(response, 401, { error: "Unauthorized." });
      const { message = {} } = await readJson(request);
      const leadId = message.call?.metadata?.leadId;
      const lead = leadId ? getLead(leadId) : null;

      if (message.type === "tool-calls") {
        const calls = message.toolCallList || message.toolCalls || [];
        const results = calls.map((tc) => {
          const name = tc.name || tc.function?.name;
          let args = tc.arguments ?? tc.function?.arguments ?? {};
          if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
          let result = "Noted.";
          if (name === "mark_opt_out" && lead) {
            applyOptOut(lead);
            logEvent({ event: "opt_out", leadId, callId: message.call?.id });
            result = "Opt-out recorded. Confirm no further calls and end the call politely.";
          } else if (name === "request_site_visit") {
            logEvent({ event: "site_visit_requested", leadId, callId: message.call?.id, preferredTime: args.preferredTime });
            result = "Site visit request saved. The sales team will confirm the appointment.";
          } else if (name === "request_human_callback") {
            logEvent({ event: "human_callback_requested", leadId, callId: message.call?.id, reason: args.reason });
            result = "Callback request saved. A sales advisor will call back.";
          }
          return { toolCallId: tc.id, result };
        });
        return send(response, 200, { results });
      }

      if (message.type === "end-of-call-report") {
        logEvent({
          event: "call_ended",
          leadId,
          callId: message.call?.id,
          endedReason: message.endedReason,
          durationSeconds: message.durationSeconds,
          summary: message.summary || message.analysis?.summary,
          transcript: message.transcript
        });
      }
      return send(response, 200, { ok: true });
    }

    return send(response, 404, {
      error: "Route not found.",
      routes: [
        "GET /health",
        "GET /api/properties",
        "GET /api/leads",
        "POST /api/calls/preview",
        "POST /api/calls/turn",
        "POST /api/calls/start",
        "POST /api/calls/start-all",
        "POST /api/vapi/webhook"
      ]
    });
  } catch (error) {
    return send(response, 400, { error: error.message || "Unexpected request error." });
  }
});

// ... existing code ...
const server = http.createServer(async (request, response) => {
// ... existing code ...
});

// Automated Calling Engine (The Auto-Pilot)
setInterval(async () => {
  const now = new Date();
  const eligibleLeads = leads.filter(l => {
    if (l.optOut) return false;
    return l.nextCallTime && new Date(l.nextCallTime) <= now;
  });

  if (eligibleLeads.length > 0) {
    console.log(`[Auto-Pilot] Found ${eligibleLeads.length} leads due for call. Initiating...`);
    for (const lead of eligibleLeads) {
      const property = requestedProperty(lead);
      if (!property) continue;

      try {
        const outbound = await startOutboundCall({ lead, property });
        if (outbound.statusCode === 202) {
          logEvent({ event: "auto_call_started", leadId: lead.id, propertyId: property.id, callId: outbound.body.callId });
          // Clear the nextCallTime so we don't call them every minute
          lead.nextCallTime = null;
          saveLeadsFile(leads);
        }
      } catch (e) {
        console.error(`[Auto-Pilot] Error calling lead ${lead.id}:`, e);
      }
    }
  }
}, 60000);

server.listen(port, () => {
  console.log("Builder call agent listening on http://localhost:" + port);
});

export { server };
