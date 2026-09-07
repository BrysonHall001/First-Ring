# First Ring — instant-call console (v0.1, simulation mode)

The admin console and backend for calling candidates within minutes of a form
submission. The phone dial itself is **simulated** in this draft so the entire
loop — toggle, queue, calling windows, retries, transcripts, dispositions,
write-back to AST — is visible and demonstrable today without any API keys.

## Run it (GitHub Codespaces or anywhere with Node 18+)

```bash
npm install
npm start
```

Open the forwarded port (3000). A demo client is seeded. Open it, press
**Simulate a form submission**, watch the lamps in the header, then check the
**Call log** tab a few seconds later.

## What's in the box

- **Clients tab** — per-client agent config: the instant-call toggle, calling
  window, retry policy, outbound number, the agent instructions box, and
  knowledge document upload (PDF / DOCX / TXT / MD → text extracted server-side
  and stored with the client).
- **Call log tab** — every completed call with disposition badge, attempt
  number, AST delivery status, and a transcript + summary viewer.
- **AST setup tab** — the exact contract for the AST developer: one endpoint he
  calls on submission, one webhook he receives when the call ends. Shared-key
  auth both directions.
- **Storage** — a JSON file at `data/db.json`. Swap for Postgres/Neon when this
  leaves draft stage (the storage layer is 3 small functions in `server.js`).

## How a call flows

1. AST form submission → AST backend POSTs to `/api/hooks/submission`
2. Job enters the queue; the worker dials when inside the client's calling window
3. (Simulated) call runs; outcome, summary, transcript recorded
4. Result POSTs to the client's AST webhook URL → candidate record updated
5. `no_answer` / `callback_requested` re-queue per the retry policy

## Road to real calls

Everything upstream and downstream of the dial is real. To make the dial real:

1. Stand up a Pipecat pipeline (separate process or container): Twilio Media
   Streams ↔ Silero VAD ↔ Deepgram streaming STT ↔ Claude (with tools:
   `log_answer`, `flag_disqualifier`, `end_call(disposition)`) ↔ Cartesia or
   ElevenLabs TTS.
2. Replace `placeSimulatedCall(job)` in `server.js` with a request to that
   pipeline; keep the same completion payload shape.
3. Fill in `.env` (see `.env.example`). Host this server + the pipeline on
   Render / Railway / Fly / a VPS — anything that keeps a process alive.
   (Not Vercel: live calls hold open WebSockets for minutes.)
4. Buy one local-area-code Twilio number per client.

## Before real candidates are ever dialed

- Add explicit consent language for automated/AI calls to the intake forms.
- Confirm calling-hours handling against the candidate's timezone (v0.1 uses
  server-local time).
- Get the pilot blessed. This talks to real people on behalf of real agencies.
