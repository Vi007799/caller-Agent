function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minutesNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.CALLING_TIMEZONE || "Asia/Kolkata",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour").value);
  const m = Number(parts.find((p) => p.type === "minute").value);
  return h * 60 + m;
}

export function withinCallingHours(date = new Date()) {
  const start = toMinutes(process.env.CALL_WINDOW_START || "10:00");
  const end = toMinutes(process.env.CALL_WINDOW_END || "19:00");
  const now = minutesNow(date);
  return now >= start && now < end;
}

export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return "+91" + digits;
  if (/^91\d{10}$/.test(digits)) return "+" + digits;
  return null;
}

// Returns a reason string if the lead must NOT be called right now, otherwise null.
export function callBlockReason(lead, { callLogs = [], now = new Date() } = {}) {
  if (!lead) return "Lead not found.";
  if (lead.sample && process.env.OUTBOUND_CALLING_ENABLED === "true") return "Sample lead with a fake number. Delete the sample leads before live calling.";
  if (!lead.consentToCall) return "Lead has not consented to calls.";
  if (lead.optOut) return "Lead is marked do not call.";
  if (process.env.REQUIRE_DND_SCRUB !== "false" && lead.dndChecked !== true) {
    return "Lead has not been checked against the DND/NCPR registry (set dndChecked: true after scrubbing).";
  }
  if (!normalizePhone(lead.phone)) return "Lead phone number is not a valid number.";
  if (!withinCallingHours(now)) return "Outside the permitted calling window.";
  const minGapHours = Number(process.env.MIN_HOURS_BETWEEN_CALLS || 24);
  const cutoff = now.getTime() - minGapHours * 3600 * 1000;
  const recent = callLogs.some((l) => l.leadId === lead.id && l.event === "call_started" && new Date(l.at).getTime() > cutoff);
  if (recent) return "This lead was already called within the last " + minGapHours + " hours.";
  return null;
}
