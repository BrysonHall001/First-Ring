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

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/* ---------------------------- tiny JSON "db" ---------------------------- */

function defaultDb() {
  return { clients: [], queue: [], calls: [] };
}

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return defaultDb();
  }
}

function saveDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = loadDb();

function id(prefix) {
  return prefix + "_" + crypto.randomBytes(5).toString("hex");
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
  saveDb(db);
  res.json(c);
});

app.delete("/api/clients/:id", (req, res) => {
  db.clients = db.clients.filter((x) => x.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
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

setInterval(() => {
  const now = Date.now();
  for (const job of db.queue) {
    if (job.status === "queued" && new Date(job.dueAt).getTime() <= now) {
      job.status = "calling";
      job.startedAt = new Date().toISOString();
      saveDb(db);
      placeSimulatedCall(job);
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

function placeSimulatedCall(job) {
  const client = db.clients.find((x) => x.id === job.clientId);
  const durationMs = 5000 + Math.floor(Math.random() * 5000);

  setTimeout(async () => {
    const outcome = pickOutcome();
    const transcript = outcome.transcript(job.candidate, client || { name: "the agency" });
    const call = {
      id: id("call"),
      simulated: true,
      clientId: job.clientId,
      clientName: client ? client.name : "(deleted client)",
      candidate: job.candidate,
      attempt: job.attempt,
      disposition: outcome.disposition,
      summary: outcome.summary,
      transcript,
      durationSeconds: transcript.length ? 30 + Math.floor(Math.random() * 120) : 0,
      startedAt: job.startedAt,
      endedAt: new Date().toISOString(),
    };
    db.calls.unshift(call);
    job.status = "done";
    job.callId = call.id;

    // Retry policy
    if (
      (outcome.disposition === "no_answer" || outcome.disposition === "callback_requested") &&
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
  }, durationMs);
}

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

/* ----------------------- integration info for the UI --------------------- */

app.get("/api/integration", (req, res) => {
  res.json({
    base: publicBase(req),
    sharedKeyHint:
      AST_SHARED_KEY === "dev-shared-key-change-me"
        ? "dev-shared-key-change-me (default — set AST_SHARED_KEY in .env)"
        : "configured via .env",
    simulation: true,
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
    phone: "+1555" + String(Math.floor(1000000 + Math.random() * 8999999)),
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
