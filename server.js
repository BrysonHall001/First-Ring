/*
 * First Ring — outbound instant-call console (v0.1, simulation mode)
 *
 * What this server does today:
 *   - Stores per-client agent config (instructions, knowledge docs, calling rules)
 *   - Exposes the hook AST calls on form submission  -> queues a call
 *   - Runs a queue worker that respects calling hours + retries
 *   - SIMULATES the actual phone call (no Twilio yet) so the full loop is visible
 *   - Posts results back to AST via webhook (if configured) and logs everything
 *
 * What gets swapped in later (see README "Road to real calls"):
 *   - placeSimulatedCall() -> a real dial via the Pipecat/Twilio orchestrator
 */

require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "data", "db.json");
const AST_SHARED_KEY = process.env.AST_SHARED_KEY || "dev-shared-key-change-me";

/* ----------------------- dial mode + Vapi config ------------------------ */
/*
 * DIAL_MODE controls how calls are placed:
 *   "simulation" (default) -> placeSimulatedCall(): fake, free, no phone rings.
 *   "real"                  -> placeRealCall(): dials via Vapi.
 * Flip it with the DIAL_MODE env var. Simulation stays forever so you can
 * test the whole loop (queue, windows, retries, writeback) without dialing.
 *
 * The three Vapi IDs live in the environment, never in code. Set them on
 * Render (Environment tab). VAPI_API_KEY is a secret; the other two are not.
 */
const DIAL_MODE = (process.env.DIAL_MODE || "simulation").toLowerCase();
const VAPI_API_KEY = process.env.VAPI_API_KEY || "";
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID || "";
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID || "";
// Optional shared secret to verify Vapi webhooks (set the same value in Vapi).
const VAPI_WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET || "";
// When true, each call uses that client's own `instructions` as the system
// prompt (the 50-client mechanism). Off by default so your first real test
// uses the exact assistant you already tuned in the Vapi dashboard.
const USE_CLIENT_INSTRUCTIONS = process.env.USE_CLIENT_INSTRUCTIONS === "true";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/* ---------------------------- tiny JSON "db" ---------------------------- */

function defaultDb() {
  return {
    clients: [],
    queue: [],
    calls: [],
    settings: { displayName: "", userName: "", theme: "blue" },
    activity: [],
  };
}

function loadDb() {
  let d;
  try {
    d = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    d = defaultDb();
  }
  // Migrate older db files that predate settings/activity.
  if (!d.settings) d.settings = { displayName: "", userName: "", theme: "blue" };
  if (!Array.isArray(d.activity)) d.activity = [];
  return d;
}

function saveDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = loadDb();

function id(prefix) {
  return prefix + "_" + crypto.randomBytes(5).toString("hex");
}

// Append a dated entry to the activity log (newest first, capped).
function logActivity(type, message) {
  db.activity.unshift({ id: id("act"), type, message, at: new Date().toISOString() });
  if (db.activity.length > 1000) db.activity.length = 1000;
  // caller is responsible for saveDb (usually already saving right after)
}

/* ------------------------------ seed data ------------------------------- */

if (db.clients.length === 0) {
  db.clients.push({
    id: id("cl"),
    name: "Demo County Sheriff's Office",
    position: "Corrections Officer",
    outboundNumber: "+1 (555) 010-0199 (placeholder)",
    instantCall: true,
    callWindowStart: "09:00",
    callWindowEnd: "20:00",
    timezone: "America/New_York",
    maxAttempts: 2,
    retryDelayMinutes: 120,
    astWebhookUrl: "",
    instructions:
      "You are a friendly recruitment assistant calling on behalf of Demo County Sheriff's Office.\n" +
      "Goal: thank the candidate for applying to the Corrections Officer position, confirm they are still interested, answer basic questions, and let them know a recruiter will follow up with next steps.\n\n" +
      "Key facts:\n" +
      "- Starting salary: $48,500 with step increases\n" +
      "- Shifts: 12-hour rotating shifts, built-in overtime available\n" +
      "- Minimum age 21, valid driver's license required\n" +
      "- No felony convictions; misdemeanors reviewed case by case\n" +
      "- Paid academy training (14 weeks)\n\n" +
      "Rules:\n" +
      "- Keep the call under 3 minutes\n" +
      "- If asked something you don't know, say a recruiter will answer that in the follow-up\n" +
      "- If they say they're no longer interested, thank them politely and end the call",
    knowledgeDocs: [],
    createdAt: new Date().toISOString(),
  });
  saveDb(db);
}

/* ------------------------------- helpers -------------------------------- */

function withinCallWindow(client, when = new Date()) {
  // v0.1: compares server-local time against the window. Timezone-correct
  // handling per candidate area code is a Road-to-real-calls item.
  const [sh, sm] = (client.callWindowStart || "09:00").split(":").map(Number);
  const [eh, em] = (client.callWindowEnd || "20:00").split(":").map(Number);
  const mins = when.getHours() * 60 + when.getMinutes();
  return mins >= sh * 60 + sm && mins <= eh * 60 + em;
}

function publicBase(req) {
  return `${req.protocol}://${req.get("host")}`;
}

/* ------------------------------- clients -------------------------------- */

app.get("/api/clients", (req, res) => {
  res.json(db.clients);
});

app.post("/api/clients", (req, res) => {
  const c = {
    id: id("cl"),
    name: req.body.name || "New client",
    position: req.body.position || "",
    outboundNumber: req.body.outboundNumber || "",
    instantCall: !!req.body.instantCall,
    callWindowStart: req.body.callWindowStart || "09:00",
    callWindowEnd: req.body.callWindowEnd || "20:00",
    timezone: req.body.timezone || "America/New_York",
    maxAttempts: Number(req.body.maxAttempts) || 2,
    retryDelayMinutes: Number(req.body.retryDelayMinutes) || 120,
    astWebhookUrl: req.body.astWebhookUrl || "",
    instructions: req.body.instructions || "",
    knowledgeDocs: [],
    createdAt: new Date().toISOString(),
  };
  db.clients.push(c);
  logActivity("client_created", `Client created: ${c.name}`);
  saveDb(db);
  res.status(201).json(c);
});

app.put("/api/clients/:id", (req, res) => {
  const c = db.clients.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Client not found" });
  const fields = [
    "name", "position", "outboundNumber", "instantCall", "callWindowStart",
    "callWindowEnd", "timezone", "maxAttempts", "retryDelayMinutes",
    "astWebhookUrl", "instructions",
  ];
  for (const f of fields) if (f in req.body) c[f] = req.body[f];
  c.maxAttempts = Number(c.maxAttempts) || 2;
  c.retryDelayMinutes = Number(c.retryDelayMinutes) || 120;
  logActivity("client_updated", `Client updated: ${c.name}`);
  saveDb(db);
  res.json(c);
});

app.delete("/api/clients/:id", (req, res) => {
  const gone = db.clients.find((x) => x.id === req.params.id);
  db.clients = db.clients.filter((x) => x.id !== req.params.id);
  if (gone) logActivity("client_deleted", `Client deleted: ${gone.name}`);
  saveDb(db);
  res.json({ ok: true });
});

/* ------------------------- settings + activity -------------------------- */

app.get("/api/settings", (req, res) => {
  res.json(db.settings);
});

app.put("/api/settings", (req, res) => {
  const { displayName, userName, theme } = req.body || {};
  if (typeof displayName === "string") db.settings.displayName = displayName;
  if (typeof userName === "string") db.settings.userName = userName;
  if (theme === "blue" || theme === "allstar") db.settings.theme = theme;
  logActivity("settings_updated", "Workspace settings updated");
  saveDb(db);
  res.json(db.settings);
});

app.get("/api/activity", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(db.activity.slice(0, limit));
});

/* ------------------------- knowledge doc upload -------------------------- */

app.post("/api/clients/:id/knowledge", upload.single("file"), async (req, res) => {
  const c = db.clients.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Client not found" });
  if (!req.file) return res.status(400).json({ error: "No file received" });

  const name = req.file.originalname || "document";
  const ext = name.toLowerCase().split(".").pop();
  let text = "";

  try {
    if (ext === "pdf") {
      const pdfParse = require("pdf-parse");
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text || "";
    } else if (ext === "docx") {
      const mammoth = require("mammoth");
      const parsed = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = parsed.value || "";
    } else if (ext === "txt" || ext === "md") {
      text = req.file.buffer.toString("utf8");
    } else {
      return res.status(400).json({ error: "Use a PDF, DOCX, TXT, or MD file" });
    }
  } catch (e) {
    return res.status(422).json({ error: "Couldn't read that file: " + e.message });
  }

  text = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return res.status(422).json({ error: "No readable text found in the file" });

  const doc = {
    id: id("doc"),
    name,
    chars: text.length,
    text: text.slice(0, 60000),
    uploadedAt: new Date().toISOString(),
  };
  c.knowledgeDocs.push(doc);
  saveDb(db);
  res.status(201).json({ id: doc.id, name: doc.name, chars: doc.chars, uploadedAt: doc.uploadedAt });
});

app.delete("/api/clients/:id/knowledge/:docId", (req, res) => {
  const c = db.clients.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Client not found" });
  c.knowledgeDocs = c.knowledgeDocs.filter((d) => d.id !== req.params.docId);
  saveDb(db);
  res.json({ ok: true });
});

/* --------------------- the hook AST (or Zapier) calls -------------------- */
/*
 * POST /api/hooks/submission
 * Headers: X-AST-Key: <shared key>
 * Body: { clientId, candidate: { firstName, lastName, phone, position, ... } }
 *
 * This is the ONLY thing the AST developer needs to call when a form with
 * instant-call enabled receives a submission.
 */

app.post("/api/hooks/submission", (req, res) => {
  if (req.get("X-AST-Key") !== AST_SHARED_KEY) {
    return res.status(401).json({ error: "Bad or missing X-AST-Key header" });
  }
  const { clientId, candidate } = req.body || {};
  const client = db.clients.find((x) => x.id === clientId);
  if (!client) return res.status(404).json({ error: "Unknown clientId" });
  if (!candidate || !candidate.phone) {
    return res.status(400).json({ error: "candidate.phone is required" });
  }
  if (!client.instantCall) {
    return res.json({ queued: false, reason: "Instant call is toggled off for this client" });
  }

  const job = enqueueCall(client, candidate, 1);
  res.status(202).json({ queued: true, jobId: job.id, scheduledFor: job.dueAt });
});

function enqueueCall(client, candidate, attempt) {
  const now = new Date();
  const inWindow = withinCallWindow(client, now);
  let dueAt = now;
  if (!inWindow) {
    const [sh, sm] = (client.callWindowStart || "09:00").split(":").map(Number);
    dueAt = new Date(now);
    if (now.getHours() * 60 + now.getMinutes() > sh * 60 + sm) dueAt.setDate(dueAt.getDate() + 1);
    dueAt.setHours(sh, sm, 0, 0);
  }
  const job = {
    id: id("job"),
    clientId: client.id,
    candidate: {
      firstName: candidate.firstName || "",
      lastName: candidate.lastName || "",
      phone: candidate.phone,
      position: candidate.position || client.position || "",
      astRecordId: candidate.astRecordId || null,
    },
    attempt,
    status: "queued",
    createdAt: now.toISOString(),
    dueAt: dueAt.toISOString(),
  };
  db.queue.push(job);
  saveDb(db);
  return job;
}

/* --------------------------- queue + worker ------------------------------ */

app.get("/api/queue", (req, res) => {
  res.json(db.queue.filter((j) => j.status === "queued" || j.status === "calling"));
});

/*
 * Per-client live stats for the panel view:
 *   active   = calls being dialed right now (job status "calling")
 *   queued   = jobs waiting to dial
 *   total    = completed calls on record for that client
 * Returned as a map keyed by clientId so the UI can render every card in one
 * fetch (better than one request per client with 50+ clients).
 */
app.get("/api/client-stats", (req, res) => {
  const stats = {};
  for (const c of db.clients) stats[c.id] = { active: 0, queued: 0, total: 0 };
  for (const j of db.queue) {
    if (!stats[j.clientId]) continue;
    if (j.status === "calling") stats[j.clientId].active++;
    else if (j.status === "queued") stats[j.clientId].queued++;
  }
  for (const call of db.calls) {
    if (stats[call.clientId]) stats[call.clientId].total++;
  }
  res.json(stats);
});

setInterval(() => {
  const now = Date.now();
  for (const job of db.queue) {
    if (job.status === "queued" && new Date(job.dueAt).getTime() <= now) {
      job.status = "calling";
      job.startedAt = new Date().toISOString();
      saveDb(db);
      if (DIAL_MODE === "real") placeRealCall(job);
      else placeSimulatedCall(job);
    }
  }
}, 2000);

/* --------------------- simulated call (swap me later) -------------------- */

const SIM_OUTCOMES = [
  {
    weight: 45,
    disposition: "interested",
    summary:
      "Candidate confirmed continued interest. Asked about salary and shift schedule; agent answered from the client fact sheet. Candidate agreed to a recruiter follow-up call.",
    transcript: (c, client) => [
      ["agent", `Hi, is this ${c.firstName || "there"}? This is the recruitment assistant for ${client.name}, calling about the ${c.position} application you just submitted.`],
      ["candidate", "Oh yeah, hi. That was fast."],
      ["agent", "We like to reach out while it's fresh. Are you still interested in the position?"],
      ["candidate", "Yeah, definitely. What's the starting pay again?"],
      ["agent", "Starting salary is $48,500 with step increases, and the academy is paid. Shifts are 12-hour rotations with overtime available."],
      ["candidate", "Okay, that works for me."],
      ["agent", "Great. A recruiter will reach out shortly with next steps, including the exam date. Anything else I can answer right now?"],
      ["candidate", "No, I think I'm good. Thanks."],
      ["agent", "Thanks for applying — talk soon."],
    ],
  },
  {
    weight: 20,
    disposition: "voicemail",
    summary: "No answer; left a voicemail confirming receipt of the application and noting a recruiter will follow up.",
    transcript: (c, client) => [
      ["agent", `Hi ${c.firstName || ""}, this is the recruitment team for ${client.name}. We received your application for ${c.position} and wanted to connect. A recruiter will follow up soon — feel free to call us back at this number.`],
    ],
  },
  {
    weight: 15,
    disposition: "no_answer",
    summary: "No answer and no voicemail available. Retry scheduled per client policy.",
    transcript: () => [],
  },
  {
    weight: 10,
    disposition: "callback_requested",
    summary: "Candidate answered but was at work; asked to be called back tomorrow morning.",
    transcript: (c, client) => [
      ["agent", `Hi, is this ${c.firstName || "there"}? Calling from ${client.name} about your ${c.position} application.`],
      ["candidate", "Hey — I'm at work right now, can you call me tomorrow morning?"],
      ["agent", "Of course. We'll reach out tomorrow morning. Thanks for applying."],
    ],
  },
  {
    weight: 10,
    disposition: "not_interested",
    summary: "Candidate said they already accepted another position. Marked not interested.",
    transcript: (c, client) => [
      ["agent", `Hi, is this ${c.firstName || "there"}? Calling from ${client.name} about your ${c.position} application.`],
      ["candidate", "Oh — I actually just took another job. Sorry."],
      ["agent", "No problem at all. We appreciate you letting us know, and good luck in the new role."],
    ],
  },
];

function pickOutcome() {
  const total = SIM_OUTCOMES.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of SIM_OUTCOMES) {
    r -= o.weight;
    if (r <= 0) return o;
  }
  return SIM_OUTCOMES[0];
}

/*
 * finalizeCall(job, result) — the SHARED "call is over, now record it" logic.
 * Both the simulated dialer and the real Vapi webhook end here, so retries and
 * AST write-back behave identically no matter how the call was placed.
 *
 * `result` is the clean seam between "how we dialed" and "what we do after":
 *   { disposition, summary, transcript, durationSeconds, simulated,
 *     answers?, needsReview? }
 * Job 1 uses disposition + summary. Job 2/3 later add `answers` (pre-screen
 * responses) and `needsReview` (the "not confident, flag a human" escape
 * hatch) — they flow straight through to the call record and the AST write-back
 * with zero rework here.
 */
async function finalizeCall(job, result) {
  const client = db.clients.find((x) => x.id === job.clientId);
  const call = {
    id: id("call"),
    simulated: !!result.simulated,
    clientId: job.clientId,
    clientName: client ? client.name : "(deleted client)",
    candidate: job.candidate,
    attempt: job.attempt,
    disposition: result.disposition,
    summary: result.summary || "",
    transcript: result.transcript || [],
    durationSeconds: result.durationSeconds || 0,
    // Job 2/3-ready: only present when the dialer actually captured them.
    ...(result.answers ? { answers: result.answers } : {}),
    ...(result.needsReview != null ? { needsReview: result.needsReview } : {}),
    startedAt: job.startedAt,
    endedAt: new Date().toISOString(),
  };
  db.calls.unshift(call);
  job.status = "done";
  job.callId = call.id;
  const who = (job.candidate.firstName || "Candidate") + " " + (job.candidate.lastName || "");
  logActivity("call_completed", `Call to ${who.trim()} (${call.clientName}): ${call.disposition.replace(/_/g, " ")}`);

  // Retry policy (unchanged: no-answer / callback re-queues per client rules)
  if (
    (result.disposition === "no_answer" || result.disposition === "callback_requested") &&
    client && job.attempt < (client.maxAttempts || 2)
  ) {
    const retry = enqueueCall(client, job.candidate, job.attempt + 1);
    retry.dueAt = new Date(Date.now() + (client.retryDelayMinutes || 120) * 60000).toISOString();
    call.retryJobId = retry.id;
  }

  // Push the result back to AST if a webhook is configured
  if (client && client.astWebhookUrl) {
    try {
      await fetch(client.astWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AST-Key": AST_SHARED_KEY },
        body: JSON.stringify({
          astRecordId: job.candidate.astRecordId,
          callId: call.id,
          disposition: call.disposition,
          summary: call.summary,
          attempt: call.attempt,
          endedAt: call.endedAt,
          // Job 2/3-ready: included only when present.
          ...(call.answers ? { answers: call.answers } : {}),
          ...(call.needsReview != null ? { needsReview: call.needsReview } : {}),
        }),
      });
      call.astDelivery = "delivered";
    } catch (e) {
      call.astDelivery = "failed: " + e.message;
    }
  } else {
    call.astDelivery = "no webhook configured";
  }

  saveDb(db);
}

/* -------------------- simulated dialer (free test mode) ------------------ */

function placeSimulatedCall(job) {
  const client = db.clients.find((x) => x.id === job.clientId);
  const durationMs = 5000 + Math.floor(Math.random() * 5000);

  setTimeout(() => {
    const outcome = pickOutcome();
    const transcript = outcome.transcript(job.candidate, client || { name: "the agency" });
    finalizeCall(job, {
      simulated: true,
      disposition: outcome.disposition,
      summary: outcome.summary,
      transcript,
      durationSeconds: transcript.length ? 30 + Math.floor(Math.random() * 120) : 0,
    });
  }, durationMs);
}

/* ------------------------ real dialer (Vapi) ---------------------------- */
/*
 * Places a real outbound call through Vapi, then returns immediately. The
 * call runs "out there"; when it ends, Vapi POSTs an end-of-call report to
 * /api/vapi/webhook, which calls finalizeCall() with the outcome.
 *
 * We tag each call with metadata.jobId so the webhook can match the report
 * back to the right job.
 */
async function placeRealCall(job) {
  if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID || !VAPI_PHONE_NUMBER_ID) {
    console.error("Real dial requested but VAPI_* env vars are not all set.");
    job.status = "failed";
    job.error = "missing VAPI env config";
    saveDb(db);
    return;
  }
  const client = db.clients.find((x) => x.id === job.clientId);

  const body = {
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    assistantId: VAPI_ASSISTANT_ID,
    customer: { number: job.candidate.phone },
    metadata: { jobId: job.id },
  };

  // Per-client prompt injection — the mechanism that scales to 50+ clients.
  // Off by default (USE_CLIENT_INSTRUCTIONS=false) so the first real test uses
  // the dashboard assistant you already tuned. Flip it on to prove per-client
  // scripts, and this is also where Job 2 pre-screen questions would live.
  if (USE_CLIENT_INSTRUCTIONS && client && client.instructions) {
    body.assistantOverrides = {
      variableValues: {
        firstName: job.candidate.firstName || "there",
        position: job.candidate.position || "",
        clientName: client.name || "",
      },
      model: { messages: [{ role: "system", content: client.instructions }] },
    };
  }

  try {
    const resp = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("Vapi call failed to start:", resp.status, text);
      job.status = "failed";
      job.error = `vapi ${resp.status}: ${text.slice(0, 200)}`;
      saveDb(db);
      return;
    }
    const data = await resp.json();
    job.vapiCallId = data.id || (data.call && data.call.id) || null;
    // job stays "calling" until the end-of-call webhook finalizes it.
    saveDb(db);
  } catch (e) {
    console.error("Vapi call error:", e.message);
    job.status = "failed";
    job.error = e.message;
    saveDb(db);
  }
}

/* ---------- map a Vapi end-of-call report -> our result shape ----------- */

function mapVapiReport(msg) {
  const call = msg.call || {};
  const endedReason = (msg.endedReason || call.endedReason || "").toLowerCase();
  const summary = msg.summary || "";

  // Build a simple [ [speaker, text], ... ] transcript from Vapi's messages.
  let transcript = [];
  if (Array.isArray(msg.messages)) {
    transcript = msg.messages
      .filter((m) => m.role === "assistant" || m.role === "user" || m.role === "bot")
      .map((m) => [m.role === "user" ? "candidate" : "agent", m.message || m.content || ""]);
  } else if (msg.transcript) {
    transcript = [["transcript", msg.transcript]];
  }

  const durationSeconds = Math.round(msg.durationSeconds || call.durationSeconds || 0);

  // Disposition: prefer a structured value if you configure Vapi analysis
  // (Job 2), otherwise derive a sensible one from how the call ended.
  const structured = (msg.analysis && msg.analysis.structuredData) || null;
  let disposition = "completed";
  if (structured && structured.disposition) {
    disposition = structured.disposition;
  } else if (endedReason.includes("no-answer") || endedReason.includes("did-not-answer") || endedReason.includes("busy")) {
    disposition = "no_answer";
  } else if (endedReason.includes("voicemail")) {
    disposition = "voicemail";
  }

  // Job 2/3-ready passthroughs (populated once Vapi structured outputs exist).
  const answers = structured && structured.answers ? structured.answers : undefined;
  const needsReview = structured && structured.needsReview != null ? structured.needsReview : undefined;

  return { simulated: false, disposition, summary, transcript, durationSeconds, answers, needsReview };
}

/* -------------------- Vapi end-of-call webhook -------------------------- */
/*
 * Point your Vapi number's Server URL at:  <your-render-url>/api/vapi/webhook
 * Vapi POSTs several event types; we only act on "end-of-call-report".
 */
app.post("/api/vapi/webhook", async (req, res) => {
  if (VAPI_WEBHOOK_SECRET && req.get("x-vapi-secret") !== VAPI_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "bad or missing webhook secret" });
  }
  const msg = req.body && req.body.message;
  if (!msg || msg.type !== "end-of-call-report") {
    return res.json({ ok: true }); // ack everything else quickly
  }

  const call = msg.call || {};
  const jobId = call.metadata && call.metadata.jobId;
  let job = jobId ? db.queue.find((j) => j.id === jobId) : null;
  if (!job && call.id) job = db.queue.find((j) => j.vapiCallId === call.id);

  if (!job) {
    console.warn("Vapi webhook: no matching job for call", call.id);
    return res.json({ ok: true });
  }
  if (job.status === "done") return res.json({ ok: true }); // idempotent

  await finalizeCall(job, mapVapiReport(msg));
  res.json({ ok: true });
});

/* -------------------------------- calls --------------------------------- */

app.get("/api/calls", (req, res) => {
  const light = db.calls.map(({ transcript, ...rest }) => ({
    ...rest,
    turns: transcript.length,
  }));
  res.json(light);
});

app.get("/api/calls/:id", (req, res) => {
  const call = db.calls.find((x) => x.id === req.params.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  res.json(call);
});

/* ---- per-client call log (that client's calls only) ---- */
app.get("/api/clients/:id/calls", (req, res) => {
  const light = db.calls
    .filter((c) => c.clientId === req.params.id)
    .map(({ transcript, ...rest }) => ({ ...rest, turns: transcript.length }));
  res.json(light);
});

/* ---- per-client analytics ---- */
app.get("/api/clients/:id/analytics", (req, res) => {
  const calls = db.calls.filter((c) => c.clientId === req.params.id);
  const total = calls.length;
  const answeredDispositions = ["interested", "completed", "callback_requested", "not_interested"];
  const answered = calls.filter((c) => answeredDispositions.includes(c.disposition));
  const interested = calls.filter((c) => c.disposition === "interested");

  // disposition breakdown
  const byDisposition = {};
  for (const c of calls) byDisposition[c.disposition] = (byDisposition[c.disposition] || 0) + 1;

  // avg duration of answered calls
  const durs = answered.map((c) => c.durationSeconds || 0).filter((d) => d > 0);
  const avgDuration = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;

  // avg attempts to reach
  const avgAttempts = total ? +(calls.reduce((a, c) => a + (c.attempt || 1), 0) / total).toFixed(1) : 0;

  // last 7 days volume (by local date)
  const days = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days[d.toISOString().slice(0, 10)] = 0;
  }
  for (const c of calls) {
    const key = (c.endedAt || "").slice(0, 10);
    if (key in days) days[key]++;
  }

  res.json({
    total,
    answered: answered.length,
    connectRate: total ? Math.round((answered.length / total) * 100) : 0,
    interested: interested.length,
    interestRate: total ? Math.round((interested.length / total) * 100) : 0,
    avgDuration,
    avgAttempts,
    byDisposition,
    last7Days: days,
  });
});

/* ----------------------- integration info for the UI --------------------- */

app.get("/api/integration", (req, res) => {
  res.json({
    base: publicBase(req),
    sharedKeyHint:
      AST_SHARED_KEY === "dev-shared-key-change-me"
        ? "dev-shared-key-change-me (default — set AST_SHARED_KEY in .env)"
        : "configured via .env",
    simulation: DIAL_MODE !== "real",
    dialMode: DIAL_MODE,
  });
});

/* -------------------------- demo: fake a submit --------------------------- */

app.post("/api/demo/submit", (req, res) => {
  const client = db.clients.find((x) => x.id === req.body.clientId);
  if (!client) return res.status(404).json({ error: "Unknown clientId" });
  const first = ["Jordan", "Casey", "Alex", "Morgan", "Taylor", "Riley", "Sam", "Devin"];
  const last = ["Reyes", "Walker", "Nguyen", "Brooks", "Carter", "Diaz", "Foster", "Hayes"];
  const candidate = {
    firstName: first[Math.floor(Math.random() * first.length)],
    lastName: last[Math.floor(Math.random() * last.length)],
    // In real dial mode, POST { clientId, phone: "+1YOURCELL" } to dial a real
    // (verified) number for testing. Left blank, it uses a fake 555 number
    // (fine for simulation mode only).
    phone: req.body.phone || "+1555" + String(Math.floor(1000000 + Math.random() * 8999999)),
    position: client.position || "Recruit",
    astRecordId: "demo_" + Date.now(),
  };
  const job = enqueueCall(client, candidate, 1);
  res.status(202).json({ queued: true, jobId: job.id, candidate });
});

app.listen(PORT, () => {
  console.log(`First Ring console running → http://localhost:${PORT}`);
  console.log(`AST hook: POST /api/hooks/submission  (header X-AST-Key)`);
});
