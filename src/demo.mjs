import { createInitialState, ruleBasedTurn } from "./agent.mjs";
import { getProperty } from "./data.mjs";
import { demoLead } from "./demo-lead.mjs";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

const lead = demoLead;
const property = getProperty(lead.enquiry.propertyId);
const state = createInitialState();
const terminal = readline.createInterface({ input, output, terminal: true });

console.log("");
console.log("Builder Call Agent — local conversation demo");
console.log("Lead: " + lead.fullName + " | Property: " + property.name);
console.log("Type exit to close the demo.");
console.log("");

const opening = ruleBasedTurn(lead, property, "", state);
console.log("Agent: " + opening.spokenText);

try {
  output.write("Lead: ");
  for await (const nextWords of terminal) {
    if (/^(exit|quit)$/i.test(nextWords.trim())) break;
    const result = ruleBasedTurn(lead, property, nextWords, state);
    console.log("Agent: " + result.spokenText);
    if (result.disposition === "opt_out") {
      console.log("Call ended: lead opted out.");
      break;
    }
    output.write("Lead: ");
  }
} finally {
  terminal.close();
}
