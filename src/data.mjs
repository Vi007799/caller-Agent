import { loadOptOuts, loadLeadsFile, loadWebLeads } from "./store.mjs";

// ===== EDIT THIS FILE FOR EACH BUILDER =====
// Builder name and project facts below are what the agent says on calls and what the website shows.
// Only put builder-approved facts here. The agent never invents anything beyond this.
export const builder = {
  name: process.env.BUILDER_NAME || "Arcadia Developers",
  shortName: "Arcadia",
  approvedCallingWindow: "10:00–19:00 local time",
  handoffPhone: process.env.SALES_HANDOFF_PHONE || "+91-00000-00000"
};

export const properties = [
  {
    id: "palm-terraces",
    name: "Palm Terraces",
    location: "Sector 79, Gurugram",
    configurations: ["3 BHK · 1,745 sq ft", "4 BHK · 2,215 sq ft"],
    priceRange: "₹1.42 Cr onwards",
    availability: "Selected homes are currently available; final availability is confirmed by the sales team.",
    highlights: [
      "clubhouse and fitness studio",
      "landscaped central greens",
      "children's play area",
      "dedicated parking"
    ],
    visitSlots: ["Saturday, 11:30 AM", "Sunday, 11:30 AM", "Sunday, 4:30 PM"],
    approvedOffer: "A site-visit briefing and current inventory update are available from the sales team."
  }
];

// Leads are added from the dashboard (/admin), not here.
export const leads = [];

// Real leads: put them in data/leads.json (same shape as above) or point LEADS_FILE at a JSON file.
const fileLeads = loadLeadsFile();
if (Array.isArray(fileLeads)) leads.splice(0, leads.length, ...fileLeads);

leads.push(...loadWebLeads()); // leads who enquired through the website

// Opt-outs survive restarts.
const optOuts = loadOptOuts();
for (const lead of leads) if (optOuts.has(lead.id)) lead.optOut = true;

export function getLead(id) {
  return leads.find((lead) => lead.id === id);
}

export function getProperty(id) {
  return properties.find((property) => property.id === id);
}
