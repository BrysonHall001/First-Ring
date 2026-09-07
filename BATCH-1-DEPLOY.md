# Batch 1 — Get First Ring running in the cloud (still fully simulated)

Goal: the seeded demo runs end-to-end on a live Render URL. No real phone
calls yet, no AST App, no Zoho. You're just proving the orchestration loop
works when it's hosted, not on your laptop.

You do NOT need to touch any code for this batch. It's verified working as-is.

---

## What you're deploying

A small Node/Express server + a static admin page (the `public/` folder).
Storage is a JSON file for now (moves to Neon in Batch 4). The "phone call"
is faked — the server waits a few seconds, picks a realistic outcome, and
logs a transcript. That's intentional: it lets you test everything around
the dial for free.

## Steps

1. **Put this folder in a GitHub repo.**
   - Create a new repo (private is fine).
   - Push the contents of this `first-ring/` folder to it.
   - `.gitignore` is already set so `node_modules`, `data/`, and secrets
     won't get committed.

2. **Create the Render service.**
   - Easiest path: in Render, use **New → Blueprint** and point it at the
     repo. The included `render.yaml` sets everything up (Node, build/start
     commands, a paid always-on instance, and an auto-generated
     AST_SHARED_KEY).
   - Manual path (if you skip the blueprint): New → Web Service →
     connect the repo → Runtime: Node → Build: `npm install` →
     Start: `npm start`. Pick the **Starter** plan, not Free (see below).

3. **Wait for the first deploy to finish**, then open the service URL
   Render gives you (looks like `https://first-ring-xxxx.onrender.com`).

## Definition of done (how you know Batch 1 is complete)

1. The admin page loads at your Render URL.
2. The **Clients** tab shows the seeded "Demo County Sheriff's Office".
3. You press **Simulate a form submission**.
4. A few seconds later, the **Call log** tab shows a completed call with a
   disposition badge, an attempt number, and a viewable transcript/summary.

If all four happen on the live URL: Batch 1 done. Move to Batch 2.

---

## Two things to know (they matter later, not just now)

- **Use the Starter plan, not Free.** Render's free tier spins the process
  down when idle. This service runs an always-on loop that checks every 2
  seconds for calls that are due — if it spins down, that loop stops and
  scheduled/after-hours/retry calls silently don't fire. Free tier will
  *look* fine while you're actively clicking (because your clicks wake it),
  which is exactly the misleading result you don't want. ~$7/mo fixes it.

- **Data resets on redeploy — that's fine for now.** Render's disk is
  ephemeral, and storage is currently a JSON file, so a redeploy wipes the
  call log and re-seeds the demo client. That's totally OK for Batch 1.
  Batch 4 swaps storage to Neon (your company's Postgres standard), which
  makes it persistent for real clients.

## The AST_SHARED_KEY

The blueprint auto-generates one. You don't need it for Batch 1 — the demo
button doesn't require it. You'll need it in Batch 5/7, when the AST App (or
Zapier) starts calling the `/api/hooks/submission` endpoint and has to prove
it's allowed to. You can read the generated value anytime in the Render
dashboard under your service → Environment.
