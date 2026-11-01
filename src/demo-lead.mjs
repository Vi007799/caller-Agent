// Used ONLY by `npm run demo` and the automated tests. Never loaded into the server or dashboard.
export const demoLead = {
    id: "lead-priya",
    firstName: "Priya",
    fullName: "Priya Mehta",
    phone: "+91-90000-00001",
    preferredLanguage: "hinglish",
    consentToCall: true,
    sample: true, // demo lead with a fake number; never dialled when live calling is on
    dndChecked: true,
    optOut: false,
    enquiry: {
      propertyId: "palm-terraces",
      interest: "3 BHK",
      budget: "₹1.4–1.7 Cr",
      source: "Website enquiry"
    }
  };
