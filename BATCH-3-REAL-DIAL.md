# Batch 3 — Real dial wired in (Vapi), simulation kept as a toggle

The fake dial has been replaced with a real one, WITHOUT removing the fake one.
A single env var (`DIAL_MODE`) chooses which runs. Everything downstream —
queue, calling windows, retries, AST write-back — is now SHARED between both
paths, so real calls behave exactly like the simulated ones you already tested.

## What changed in the code (so you/Joe can follow it)

- `finalizeCall(job, result)` — new shared function. "Call is over, record it,
  run retry policy, write back to AST." Both dialers end here.
- `placeSimulatedCall()` — same behavior as before, now just builds a `result`
  and hands it to `finalizeCall`.
- `placeRealCall()` — NEW. Places the call via Vapi's API, then returns. The
  outcome arrives later by webhook.
- `POST /api/vapi/webhook` — NEW. Vapi calls this when a call ends; it matches
  the report to the job and calls `finalizeCall`.
- The result shape carries optional `answers` and `needsReview` fields that are
  unused today but are where Job 2 (pre-screen) and Job 3 (structured
  write-back) slot in later — no rework needed.

## One-time Vapi + Render setup for real calls

1. **Render → your service → Environment.** Add:
   - `DIAL_MODE` = `real`
   - `VAPI_API_KEY` = your Vapi private key   ← secret, only lives here
   - `VAPI_ASSISTANT_ID` = 716c4e21-0513-484c-ac09-099d2b097408
   - `VAPI_PHONE_NUMBER_ID` = 21d63d43-25ac-4dd3-a8d8-76c7728f89da
   - (leave `USE_CLIENT_INSTRUCTIONS` = `false` for the first test)
   Save; Render redeploys.

2. **Point Vapi at your webhook.** In Vapi → Phone Numbers → your number →
   **Server URL**, set:
   `https://YOUR-RENDER-URL.onrender.com/api/vapi/webhook`
   (Optional: set a Server URL **secret** in Vapi and put the same string in
   `VAPI_WEBHOOK_SECRET` on Render.)

## Test it (dial your own verified cell)

Because real mode dials for real, don't use the plain demo button (it invents a
fake 555 number). Instead, POST your own verified cell as the candidate:

```bash
curl -X POST https://YOUR-RENDER-URL.onrender.com/api/demo/submit \
  -H "Content-Type: application/json" \
  -d '{"clientId":"PASTE_A_CLIENT_ID","phone":"+1YOURCELL"}'
```

(Get a clientId from the Clients tab or `GET /api/clients`.)

**Done when:** your phone rings, the agent runs the script, and a few seconds
after you hang up the call shows in the **Call log** with a disposition — same
as the simulated calls, but real.

## Flip back to free testing anytime

Set `DIAL_MODE` = `simulation` on Render. No phone rings, no spend, whole loop
still testable. This is also the mode to demo if you'd rather not dial live.

## Notes / known edges (fine for now, tighten before real candidates)

- If a real call never produces a webhook (rare), its job stays "calling". Not a
  problem for a demo; a sweeper is a Batch 4 hardening item.
- Disposition for answered calls defaults to "completed". Finer dispositions
  (interested / not_interested) and pre-screen answers come from Vapi's
  structured-output analysis — that's the Job 2 wiring, already stubbed in
  `mapVapiReport()`.
- Rotate your Vapi API key once everything works, if it was ever pasted outside
  Render.
