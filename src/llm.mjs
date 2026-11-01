import { buildAgentInstruction, ruleBasedTurn } from "./agent.mjs";

const turnSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spokenText", "intent", "disposition", "captured", "nextAction", "handoffRequired"],
  properties: {
    spokenText: { type: "string", minLength: 1, maxLength: 700 },
    intent: { type: "string" },
    disposition: { type: "string" },
    captured: { type: "object", additionalProperties: true },
    nextAction: { type: "string" },
    handoffRequired: { type: "boolean" }
  }
};

function parseOutput(data) {
  if (typeof data.output_text === "string" && data.output_text.length > 0) return data.output_text;
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  throw new Error("The model response did not contain text output.");
}

function validateTurn(turn) {
  if (!turn || typeof turn !== "object") throw new Error("Model output was not an object.");
  if (typeof turn.spokenText !== "string" || !turn.spokenText.trim()) throw new Error("Model output lacked spokenText.");
  return {
    spokenText: turn.spokenText.trim(),
    intent: String(turn.intent || "general_interest"),
    disposition: String(turn.disposition || "open"),
    captured: typeof turn.captured === "object" && turn.captured ? turn.captured : {},
    nextAction: String(turn.nextAction || "continue_conversation"),
    handoffRequired: Boolean(turn.handoffRequired)
  };
}

async function openAiTurn(lead, property, callerSaid, state) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const transcript = state.transcript.map((entry) => entry.role + ": " + entry.text).join("\n");
  const input = [
    { role: "system", content: buildAgentInstruction(lead, property, state) },
    { role: "user", content: "Conversation so far:\n" + (transcript || "(call just started)") + "\n\nLead's latest words:\n" + (callerSaid || "(start the call)") }
  ];

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + apiKey
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input,
      text: {
        format: {
          type: "json_schema",
          name: "builder_call_turn",
          strict: true,
          schema: turnSchema
        }
      }
    })
  });

  if (!apiResponse.ok) {
    const detail = await apiResponse.text();
    throw new Error("OpenAI request failed (" + apiResponse.status + "): " + detail.slice(0, 300));
  }

  return validateTurn(JSON.parse(parseOutput(await apiResponse.json())));
}

export async function generateTurn(lead, property, callerSaid, state) {
  const provider = (process.env.LLM_PROVIDER || "rule-based").toLowerCase();

  if (provider === "openai") {
    try {
      const turn = await openAiTurn(lead, property, callerSaid, state);
      return { turn, provider: "openai", fallbackReason: null };
    } catch (error) {
      const turn = ruleBasedTurn(lead, property, callerSaid, state);
      return { turn, provider: "rule-based-fallback", fallbackReason: error.message };
    }
  }

  return {
    turn: ruleBasedTurn(lead, property, callerSaid, state),
    provider: "rule-based",
    fallbackReason: null
  };
}
