import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.env.DATA_DIR || "./data");

export function loadAgentScript() {
  try {
    const file = path.join(dataDir, "agent-script.json");
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function saveAgentScript(script) {
  ensureDir();
  fs.writeFileSync(path.join(dataDir, "agent-script.json"), JSON.stringify(script, null, 2));
}

export function loadOptOuts() {
  try {
    return new Set(JSON.parse(fs.readFileSync(path.join(dataDir, "optouts.json"), "utf8")));
  } catch {
    return new Set();
  }
}

export function saveOptOut(key) {
  ensureDir();
  const set = loadOptOuts();
  set.add(key);
  fs.writeFileSync(path.join(dataDir, "optouts.json"), JSON.stringify([...set], null, 2));
}

export function appendCallLog(record) {
  ensureDir();
  fs.appendFileSync(path.join(dataDir, "call-logs.jsonl"), JSON.stringify(record) + "\n");
}

export function loadCallLogs() {
  try {
    return fs.readFileSync(path.join(dataDir, "call-logs.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function loadLeadsFile() {
  const file = path.resolve(process.env.LEADS_FILE || path.join(dataDir, "leads.json"));
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function saveLeadsFile(leads) {
  ensureDir();
  const file = path.resolve(process.env.LEADS_FILE || path.join(dataDir, "leads.json"));
  fs.writeFileSync(file, JSON.stringify(leads, null, 2));
}

export function loadWebLeads() {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "web-leads.json"), "utf8"));
  } catch {
    return [];
  }
}

export function saveWebLead(lead) {
  ensureDir();
  const all = loadWebLeads();
  all.push(lead);
  fs.writeFileSync(path.join(dataDir, "web-leads.json"), JSON.stringify(all, null, 2));
}
