# Handover guide: Builder Call Agent

## 1. What the builder receives
- **Dashboard** (`/admin`): the sales team adds leads, clicks Call, and sees every call's outcome, summary and transcript.
- **Website** (`/`): a 3D project page with a chat advisor and a site-visit request form.
- **Calling agent**: calls leads in easy Hindi + English, shares only approved project facts, books site-visit requests, asks for a sales advisor callback when needed, and stops calling anyone who asks.

## 2. Accounts that must be in the BUILDER's name
Create these with the builder's email and payment method, so billing, recordings and phone numbers belong to them:
1. **Vapi** (voice platform): API key and phone number ID.
2. **Phone number provider** that supports calling India (Exotel, Twilio or Plivo), connected to Vapi. The builder, not you, should hold the number and any telemarketer registration.
3. **Voice provider** (e.g. ElevenLabs): the chosen voice ID.
4. **Hosting** (see section 3).
Never hand over your own personal keys. Use the builder's keys in the builder's `.env` or hosting settings.

## 3. Hosting (important)
The server stores leads, opt-outs and call history in the `data` folder. That folder must survive restarts.
- Use a **VPS** (any small Linux server) or a host with a **persistent disk** (Render or Railway paid disks, Fly.io volumes).
- **Do not use a free tier without a persistent disk.** Files vanish on restart, and the agent could forget who asked not to be called, which is a compliance risk.
- Run it with the included `Dockerfile` and mount a persistent volume at `/data` (`DATA_DIR=/data`), or run `npm start` with a persistent `DATA_DIR`.
- Serve it over https (the host usually does this) and set `PUBLIC_BASE_URL` to that address.
- Back up the data folder regularly.

## 4. Settings to fill in (copy `.env.example`)
`VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VOICE_ID`, `PUBLIC_BASE_URL`, `WEBHOOK_SECRET`, `ADMIN_KEY`, `OUTBOUND_CALLING_ENABLED=true`.
`ADMIN_KEY` is the dashboard password: choose something long and share it only with the sales team.

## 5. Builder's project details
Edit `src/data.mjs` (builder name, project name, location, configurations, price, highlights, visit slots, approved offer). The agent and website use only these facts. Have the builder approve every line.

## 6. Day-to-day use (sales team)
1. Open `/admin` and enter the admin key.
2. Add leads (single, or paste many). Tick the consent/DND confirmation only if it is true.
3. Click **Call** on one lead, or **Call all ready leads**.
4. Check **Call outcomes**: follow up on "Wants a site visit" and "Wants a callback" the same day.
5. Use **Do not call** whenever someone asks to be removed by any other channel.

## 7. The builder's responsibilities
- Call only people who have agreed to be contacted, and check numbers against the DND registry.
- Complete telemarketer registration and use the number series the telecom rules require. Confirm the current rules with the telephony provider or a lawyer.
- Keep calls within permitted hours (default 10:00 to 19:00 IST) and keep the one-call-per-day limit.
- Review call recordings and transcripts regularly, especially in the first two weeks.
- The agent should never deny being an AI if someone sincerely asks, and it doesn't.

## 8. Before the first real campaign
1. Test with the team's own phones (outside hours, change the window temporarily, then restore it).
2. Pilot 10 to 20 real leads, listen to the calls, fix wording in `src/voice-prompt.mjs`.
3. Only then scale up.

## 9. Known limits
- Call results live in the dashboard/data folder; no automatic CRM sync yet.
- Site-visit and callback requests need a person to follow up (no automatic alerts yet).
- The website form does not verify phone ownership (OTP not added yet).
- Transfer to a live human during a call is off by default and must be tested before enabling.
