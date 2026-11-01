# Go-live guide: making real calls

## 1\. Accounts you need

1. **Vapi** (vapi.ai): create an account and copy your API key into `VAPI\\\_API\\\_KEY`.
2. **An Indian phone number** for outbound calls. Buy/import it in Vapi (usually via an Indian SIP trunk from Exotel, Plivo, Twilio, etc.) and copy its ID into `VAPI\\\_PHONE\\\_NUMBER\\\_ID`. Ask your telephony provider about TRAI telemarketer registration and the correct number series for promotional calls.
3. **A voice**: in Vapi's voice provider (ElevenLabs, Sarvam, etc.), choose a natural Hindi/Indian-English voice and put its ID in `VOICE\\\_ID`.

## 2\. Put the server online

Vapi must reach your server, so `localhost` is not enough.

* Quick test: `ngrok http 3030`, then set `PUBLIC\\\_BASE\\\_URL` to the https URL.
* Real use: deploy to Render, Railway, a VPS, etc. and use that https URL.
* Set `WEBHOOK\\\_SECRET` to a long random string.

## 3\. Configure

Copy `.env.example` to `.env`, fill in the values, and load them (e.g. `node --env-file=.env src/server.mjs`).

## 4\. Real data

* Property: edit `src/data.mjs` with only builder-approved facts.
* Leads: add them from the dashboard (`/admin`). No leads are pre-loaded. Each needs consent and a DND check, which you confirm with the tick box.

## 5\. Test on yourself

1. Add yourself as a lead with your own number.
2. Set `OUTBOUND\\\_CALLING\\\_ENABLED=true`.
3. Call only within the allowed window (default 10:00 to 19:00 IST):
`curl -X POST http://localhost:3030/api/calls/start -d '{"leadId":"lead-you"}'`
4. Answer, try: price questions, a site visit, "are you a robot?", "don't call me again".
5. Check `data/call-logs.jsonl` for the summary and transcript.

## 6\. Pilot, then scale

Run 10 to 20 real leads, listen to recordings in the Vapi dashboard, fix the prompt in `src/voice-prompt.mjs`, then use
`POST /api/calls/start-all` with `{"confirm": true, "limit": 20}`.

## Built-in safeguards

* Calls only leads with consent, not opted out, DND-checked, valid number
* Calling window enforced (IST by default); max one call per lead per 24h
* Opt-outs are saved to disk and survive restarts
* Agent answers truthfully if sincerely asked whether it is a human or machine
* All outcomes (opt-out, site-visit request, callback request, summary, transcript) logged to `data/call-logs.jsonl`

## Not done yet

* CRM sync (logs are in a local file; send them to the client's CRM or Google Sheet)
* Pushing real callback/site-visit requests to the sales team (WhatsApp/email alert)
* Live transfer to a human (set `ENABLE\\\_LIVE\\\_TRANSFER=true` and a real `SALES\\\_HANDOFF\\\_PHONE`; test it first)
* Vapi settings (model, voice, transcriber names) can change; confirm them in Vapi's docs/dashboard if a call fails to start

\---

# The 3D website (public/index.html)

The server now serves the website at `/`. Start it (`npm start`), open http://localhost:3030, and you get:

* A 3D model of the project you can drag to rotate and scroll to zoom, with a morning-to-evening slider and clickable spots (clubhouse, greens, towers).
* **Talk to our advisor**: chat (and a mic button in Chrome) answered by the same agent logic. It runs on the server, so it needs no phone setup.
* **Book a site visit**: a form with a mandatory consent checkbox. Once calling is live, it saves the lead and the agent phones the visitor.

Editing: project name, price and location come from `src/data.mjs`. Colours and fonts are at the top of `public/index.html`.

## Before putting the website on the internet

1. Set `ADMIN\\\_KEY`. Without it, the lead list, transcripts and call controls are locked off whenever `PUBLIC\\\_BASE\\\_URL` is set. Send the key as an `x-admin-key` header to use them.
2. The form does not verify that the visitor owns the number they typed. For real use, add an OTP step (SMS/WhatsApp) so nobody can trigger calls to someone else.
3. Website enquirers are saved but not auto-called until the client confirms their DND status: set `WEB\\\_LEADS\\\_DND\\\_CLEARED=true` only when that is true.
4. The form is limited to 5 requests per hour per visitor IP.
5. Deploy over https (Render, Railway, VPS, etc.).

\---

# The dashboard (open /admin)

`npm run start:env`, then open http://localhost:3030/admin (when the server is online, it asks for your `ADMIN\\\_KEY`).

* **Add leads**: one at a time, or paste many lines from Excel/Sheets (name, phone, 3 BHK or 4 BHK, budget). You must tick the box confirming consent and DND check.
* **Leads table**: shows if each lead is Ready or why they are waiting (outside calling hours, already called today, do not call). **Call** places one call; **Call all ready leads** calls them one after another.
* **Call outcomes**: every call is its own card with the result (wants a site visit, wants a callback, asked not to be called, no answer), preferred visit time, summary and transcript.

# Windows quickstart: make the agent call you

1. Unzip the project, open PowerShell in that folder, run `copy .env.example .env`.
2. **Vapi**: sign up at vapi.ai, copy your API key into `VAPI\\\_API\\\_KEY`.
3. **Phone number**: for calls to Indian numbers, import a number from a provider that supports India (Exotel, Twilio, Plivo) into Vapi, then copy its ID into `VAPI\\\_PHONE\\\_NUMBER\\\_ID`. (Twilio trial accounts can only call numbers you have verified, which is fine for your first test.)
4. **Voice**: choose a voice in ElevenLabs (or your voice provider) and copy its ID into `VOICE\\\_ID`.
5. **Public address**: install ngrok, run `ngrok http 3030`, copy the https address into `PUBLIC\\\_BASE\\\_URL`.
6. Set `WEBHOOK\\\_SECRET` and `ADMIN\\\_KEY` to long random words, and `OUTBOUND\\\_CALLING\\\_ENABLED=true`.
7. For testing outside 10:00 to 19:00, temporarily set `CALL\\\_WINDOW\\\_START=00:00` and `CALL\\\_WINDOW\\\_END=23:59`. Restore it before real leads.
8. Start: `npm run start:env`
9. Open http://localhost:3030/admin, enter your ADMIN\_KEY, add yourself as a lead (your own number), click **Call**.
10. Answer. Try a price question, a site visit request and "don't call me again". Refresh the dashboard to see the outcome card.
11. Before real leads: restore the calling window, add the client's real leads, and run a pilot of 10 to 20.

