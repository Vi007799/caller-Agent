import { builder } from "./data.mjs";
import { createCallBrief } from "./agent.mjs";
import { normalizePhone } from "./calling-rules.mjs";
import { voiceFirstMessage, voiceSystemPrompt } from "./voice-prompt.mjs";

const VAPI_URL = "https://api.vapi.ai/call";

function tools(serverUrl) {
  const server = { url: serverUrl };
  const list = [
    {
      type: "function",
      function: {
        name: "mark_opt_out",
        description: "Call when the person asks not to be called again or is not interested in further calls.",
        parameters: { type: "object", properties: {}, required: [] }
      },
      server
    },
    {
      type: "function",
      function: {
        name: "request_site_visit",
        description: "Call when the person wants a site visit. Pass their preferred day and time.",
        parameters: {
          type: "object",
          properties: { preferredTime: { type: "string", description: "e.g. Sunday 4:30 PM" } },
          required: ["preferredTime"]
        }
      },
      server
    },
    {
      type: "function",
      function: {
        name: "request_human_callback",
        description: "Call when the person wants a sales advisor, or asks something outside the approved facts.",
        parameters: {
          type: "object",
          properties: { reason: { type: "string" } },
          required: ["reason"]
        }
      },
      server
    }
  ];

  const handoff = process.env.SALES_HANDOFF_PHONE;
  if (process.env.ENABLE_LIVE_TRANSFER === "true" && handoff && !/00000-00000/.test(handoff)) {
    list.push({
      type: "transferCall",
      destinations: [{ type: "number", number: handoff, message: "Ek second, main aapko hamare sales advisor se connect karti hoon." }],
      function: { name: "transfer_to_sales" }
    });
  }
  return list;
}

export async function startOutboundCall({ lead, property }) {
  if (process.env.OUTBOUND_CALLING_ENABLED !== "true") {
    return {
      statusCode: 409,
      body: {
        error: "Live calling is disabled.",
        detail: "Set OUTBOUND_CALLING_ENABLED=true after completing the go-live checklist.",
        preview: createCallBrief(lead, property)
      }
    };
  }

  const required = ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "PUBLIC_BASE_URL", "VOICE_ID"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    return { statusCode: 500, body: { error: "Missing configuration.", missing } };
  }

  const serverUrl = process.env.PUBLIC_BASE_URL.replace(/\/$/, "") + "/api/vapi/webhook";
  const payload = {
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
    customer: { number: normalizePhone(lead.phone), name: lead.fullName },
    assistant: {
      name: builder.shortName + " Advisor",
      firstMessage: voiceFirstMessage(lead, property),
      model: {
        provider: process.env.VOICE_LLM_PROVIDER || "openai",
        model: process.env.VOICE_LLM_MODEL || "gpt-4o-mini",
        temperature: 0.4,
        messages: [{ role: "system", content: voiceSystemPrompt(lead, property) }],
        tools: tools(serverUrl)
      },
      voice: {
        provider: process.env.VOICE_PROVIDER || "11labs",
        voiceId: process.env.VOICE_ID
      },
      transcriber: {
        provider: process.env.STT_PROVIDER || "deepgram",
        model: process.env.STT_MODEL || "nova-3",
        language: process.env.STT_LANGUAGE || "multi"
      },
      server: { url: serverUrl, secret: process.env.WEBHOOK_SECRET || undefined },
      serverMessages: ["end-of-call-report", "tool-calls", "status-update"],
      endCallFunctionEnabled: true,
      maxDurationSeconds: Number(process.env.MAX_CALL_SECONDS || 300),
      silenceTimeoutSeconds: 20,
      metadata: { leadId: lead.id, propertyId: property.id }
    }
  };

  const res = await fetch(VAPI_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + process.env.VAPI_API_KEY },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }

  if (!res.ok) {
    return { statusCode: 502, body: { error: "Vapi rejected the call.", status: res.status, detail: data } };
  }
  return { statusCode: 202, body: { status: "call_started", callId: data.id, leadId: lead.id } };
}
