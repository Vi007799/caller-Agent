import { builder } from "./data.mjs";
import { loadAgentScript } from "./store.mjs";

const OPT_OUT_PATTERN = /\b(do not call|don't call|stop calling|unsubscribe|not interested|mat call|call mat|nahi chahiye|band karo|remove my number|stop messaging)\b/i;
const HUMAN_PATTERN = /\b(human|person|representative|executive|manager|advisor|sales team|baat karni|expert|specialist)\b/i;
const VISIT_PATTERN = /\b(site visit|visit|tour|aana|dekhna|weekend|saturday|sunday|visit karna|office aana)\b/i;
const PRICE_PATTERN = /\b(price|cost|budget|rate|kitne|kitna|pricing|amount|costing)\b/i;
const LOCATION_PATTERN = /\b(location|where|kahan|sector|nearby|address|map|reach)\b/i;
const AMENITY_PATTERN = /\b(amenities|amenity|clubhouse|gym|parking|garden|play area|facility|features|facilities)\b/i;

export function createCallBrief(lead, property) {
  return {
    lead: lead.fullName,
    preferredLanguage: lead.preferredLanguage,
    property: property.name,
    enquiry: lead.enquiry,
    opener: "Hello " + lead.firstName + " ji, main " + builder.name + " ki taraf se call kar raha/rahi hoon. Aapne " + property.name + " mein " + lead.enquiry.interest + " ke baare mein enquiry ki thi. Kya abhi two minutes baat karna convenient hoga?"
  };
}

export function createInitialState() {
  return {
    opened: false,
    language: "hinglish",
    transcript: [],
    bookedVisit: null,
    disposition: "open"
  };
}

export function buildAgentInstruction(lead, property, state) {
  const facts = {
    builder: builder.name,
    property: {
      name: property.name,
      location: property.location,
      configurations: property.configurations,
      priceRange: property.priceRange,
      availability: property.availability,
      highlights: property.highlights,
      visitSlots: property.visitSlots,
      approvedOffer: property.approvedOffer
    },
    lead: {
      firstName: lead.firstName,
      languagePreference: lead.preferredLanguage,
      enquiry: lead.enquiry
    },
    callState: state
  };

  // Try to load dynamic script from store, fallback to professional default
  const config = loadAgentScript ? loadAgentScript() : null;
  const systemPrompt = config?.prompt || [
    "You are an Elite Real Estate Consultant for " + builder.name + ".",
    "Your goal is to qualify leads, handle objections professionally, and secure high-intent site visits or sales-advisor callbacks.",
    "Persona: Confident, authoritative yet extremely courteous, persuasive, and focused on value rather than just price.",
    "Do not introduce yourself as AI. You are calling on behalf of the builder.",
    "If directly asked whether you are human or AI, do not falsely claim to be a person. State that you are the builder's virtual consultant designed to provide immediate information, and offer a seamless handoff to a senior sales advisor.",
    "Communication Style:",
    "- Speak in short, clear, everyday Hinglish by default. Use professional real-estate terminology: site visit, budget, floor plan, loan, amenities, availability, and possession.",
    "- Avoid overly formal Hindi or robotic English. Switch to English if the lead initiates or requests it.",
    "- Use active listening cues (e.g., 'I understand', 'Absolutely', 'Right') to build rapport.",
    "Guidelines:",
    "- Use only the approved facts below. Never invent price, availability, possession dates, discounts, or legal claims.",
    "- Be promotional but never pushy. Use value-based selling: instead of 'it is cheap', say 'it offers exceptional value for the location'.",
    "- Ask one targeted question at a time to maintain control of the conversation.",
    "- Honor an opt-out immediately: acknowledge it politely, confirm no further calls, set disposition to 'do_not_call', and end the call.",
    "- For site visits, offer only listed slots or request a specific preferred time for sales-team confirmation.",
    "Outcomes to Capture:",
    "- 'site_visit_scheduled': Lead agreed to a visit time.",
    "- 'callback_requested': Lead wants a senior advisor to call back.",
    "- 'not_interested': Lead is explicitly not interested in this project.",
    "- 'do_not_call': Lead wants to be removed from all lists.",
    "- 'follow_up_later': Lead asked to be called at a specific future time/date.",
    "Return strict JSON with spokenText, intent, disposition, captured, nextAction, and handoffRequired.",
    "APPROVED CONTEXT:",
    JSON.stringify(facts)
  ].join("\n");

  return typeof systemPrompt === "string" ? systemPrompt : systemPrompt.join("\n");
}

function detectLanguage(text, defaultLanguage) {
  if (/\b(english please|speak english|in english)\b/i.test(text)) return "english";
  if (/[\u0900-\u097F]/.test(text)) return "hinglish";
  return defaultLanguage === "english" ? "english" : "hinglish";
}

function response(spokenText, intent, disposition, captured, nextAction, handoffRequired) {
  return { spokenText, intent, disposition, captured, nextAction, handoffRequired };
}

export function ruleBasedTurn(lead, property, callerSaid, state) {
  const said = (callerSaid || "").trim();
  const language = detectLanguage(said, state.language || lead.preferredLanguage);
  state.language = language;

  if (!state.opened) {
    state.opened = true;
    const opener = language === "english"
      ? "Hello " + lead.firstName + ", I am calling on behalf of " + builder.name + " regarding your enquiry for " + lead.enquiry.interest + " at " + property.name + ". Is this a convenient time for a quick update?"
      : createCallBrief(lead, property).opener;
    return response(opener, "opening", "open", {}, "await_response", false);
  }

  if (state.disposition === "visit_pending" && /\b(saturday|sunday|monday|tuesday|wednesday|thursday|friday|morning|afternoon|evening|\d{1,2}(:\d{2})?\s*(am|pm))\b/i.test(said)) {
    state.bookedVisit = said;
    const message = language === "english"
      ? "Perfect. I have noted your preferred site-visit time as " + said + ". Our sales team will confirm the appointment shortly."
      : "Perfect. Maine aapka preferred site-visit time " + said + " note kar liya hai. Sales team appointment shortly confirm kar degi.";
    return response(message, "visit_requested", "visit_requested", { wantsSiteVisit: true, preferredVisitTime: said }, "sales_confirm_visit", false);
  }

  if (OPT_OUT_PATTERN.test(said)) {
    const message = language === "english"
      ? "Understood. I will mark this number as do not call. Thank you for your time."
      : "Bilkul, main aapka number do-not-call list mein mark kar deta/deti hoon. Aapke time ke liye thank you.";
    return response(message, "opt_out", "opt_out", { optOut: true }, "suppress_future_calls", false);
  }

  if (HUMAN_PATTERN.test(said)) {
    const message = language === "english"
      ? "Certainly. I will arrange a call back from a sales advisor who can help with the details."
      : "Zaroor. Main sales advisor se aapke liye call back arrange kar deta/deti hoon; woh details mein help karenge.";
    return response(message, "human_handoff", "handoff_requested", {}, "create_sales_callback", true);
  }

  if (VISIT_PATTERN.test(said)) {
    const slots = property.visitSlots.join(", ");
    const message = language === "english"
      ? "A site visit is a great way to experience the project. We can request " + slots + ". Which option works best, or would you prefer another time for the sales team to confirm?"
      : "Site visit best rahega. Hum " + slots + " mein se ek slot request kar sakte hain. Aapko kaunsa option convenient rahega, ya koi preferred time hai jise sales team confirm kar le?";
    state.disposition = "visit_pending";
    return response(message, "site_visit", "visit_pending", { wantsSiteVisit: true }, "confirm_visit_slot", false);
  }

  if (PRICE_PATTERN.test(said)) {
    const message = language === "english"
      ? property.name + " is currently listed at " + property.priceRange + "." + (lead.enquiry.budget ? " Your stated budget is " + lead.enquiry.budget + "." : "") + " Would you like a sales advisor to share the matching layouts and current inventory?"
      : property.name + " ka current price " + property.priceRange + " hai." + (lead.enquiry.budget ? " Aapne " + lead.enquiry.budget + " budget mention kiya tha." : "") + " Kya matching layouts aur current inventory ke liye sales advisor ka call arrange kar doon?";
    return response(message, "price_question", "qualified", { discussedPrice: true }, "offer_advisor_callback", false);
  }

  if (LOCATION_PATTERN.test(said)) {
    const message = language === "english"
      ? property.name + " is located in " + property.location + ". Would you like to plan a site visit so the sales team can walk you through connectivity and the project?"
      : property.name + " " + property.location + " mein located hai. Kya aap site visit plan karna chahenge, jahan sales team connectivity aur project details share kar sake?";
    return response(message, "location_question", "interested", { discussedLocation: true }, "offer_site_visit", false);
  }

  if (AMENITY_PATTERN.test(said)) {
    const highlights = property.highlights.join(", ");
    const message = language === "english"
      ? "The approved project highlights include " + highlights + ". I can arrange a site visit or advisor callback for a fuller walkthrough."
      : "Project ke approved highlights mein " + highlights + " include hain. Detailed walkthrough ke liye main site visit ya advisor callback arrange kar sakta/sakti hoon.";
    return response(message, "amenities_question", "interested", { discussedAmenities: true }, "offer_site_visit", false);
  }

  const message = language === "english"
    ? "Thank you. Based on your enquiry for " + lead.enquiry.interest + ", " + property.name + " offers " + property.configurations.join(" and ") + " in " + property.location + ". Would you prefer a site visit or a callback from a sales advisor?"
    : "Thank you. Aapki " + lead.enquiry.interest + " enquiry ke hisaab se, " + property.name + " mein " + property.configurations.join(" aur ") + " options hain, " + property.location + " mein. Aap site visit prefer karenge ya sales advisor ka callback?";
  return response(message, "general_interest", "interested", {}, "offer_site_visit_or_callback", false);
}
