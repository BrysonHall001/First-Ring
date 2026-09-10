let clients = [];
let selectedClientId = null;
let selectedCallId = null;
let clientView = "panels"; // "panels" | "table"
let clientStats = {};

const $ = (s) => document.querySelector(s);

/* --------------------------------- tabs ---------------------------------- */

document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".view").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("#view-" + t.dataset.view).classList.add("active");
  });
});

/* -------------------------------- clients -------------------------------- */

async function loadClients() {
  clients = await (await fetch("/api/clients")).json();
  renderClientList();
  renderClientPanels();
  if (selectedClientId && !clients.find((c) => c.id === selectedClientId)) {
    selectedClientId = null;
    $("#clientEditor").innerHTML = '<p class="empty">Select a client to edit its agent, or add a new one.</p>';
  }
}

/* -------- view toggle (panels vs table) -------- */
function setClientView(mode) {
  clientView = mode;
  $("#clientPanels").hidden = mode !== "panels";
  $("#clientSplit").hidden = mode !== "table";
  $("#vtPanels").classList.toggle("active", mode === "panels");
  $("#vtTable").classList.toggle("active", mode === "table");
}
$("#vtPanels").addEventListener("click", () => setClientView("panels"));
$("#vtTable").addEventListener("click", () => setClientView("table"));

/* -------- panel cards with live call state -------- */
function renderClientPanels() {
  const wrap = $("#clientPanels");
  if (!clients.length) {
    wrap.innerHTML = '<p class="empty" style="color:#fff">No clients yet. Press “Add client” to create one.</p>';
    return;
  }
  wrap.innerHTML = clients
    .map((c) => {
      const s = clientStats[c.id] || { active: 0, queued: 0, total: 0 };
      const active = s.active > 0;
      const callState = active
        ? `<span class="pcard-callstate active"><span class="dot"></span>${s.active} call${s.active > 1 ? "s" : ""} live</span>`
        : (s.queued > 0
            ? `<span class="pcard-callstate active"><span class="dot"></span>${s.queued} queued</span>`
            : `<span class="pcard-callstate idle"><span class="dot"></span>Idle</span>`);
      return `
      <button class="pcard" data-client="${c.id}">
        <div class="pcard-top">
          <div>
            <div class="pcard-name">${esc(c.name)}</div>
            <div class="pcard-pos">${esc(c.position || "—")}${c.instantCall ? "" : ' · <span class="pcard-off">calls off</span>'}</div>
          </div>
          ${callState}
        </div>
        <div class="pcard-stats">
          <div class="pcard-stat"><span class="num">${s.active}</span><span class="lbl">Live now</span></div>
          <div class="pcard-stat"><span class="num">${s.total}</span><span class="lbl">Total calls</span></div>
          <div class="pcard-stat"><span class="num">${s.queued}</span><span class="lbl">Queued</span></div>
        </div>
      </button>`;
    })
    .join("");
  wrap.querySelectorAll(".pcard").forEach((card) => {
    card.addEventListener("click", () => {
      setClientView("table");
      selectClient(card.dataset.client);
    });
  });
}

async function refreshClientStats() {
  try {
    clientStats = await (await fetch("/api/client-stats")).json();
    if (clientView === "panels") renderClientPanels();
  } catch {}
}

function renderClientList() {
  const ul = $("#clientList");
  ul.innerHTML = "";
  for (const c of clients) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = c.id === selectedClientId ? "selected" : "";
    b.innerHTML = `${esc(c.name)} ${c.instantCall ? "" : '<span class="off">call off</span>'}<span class="pos">${esc(c.position || "—")}</span>`;
    b.addEventListener("click", () => selectClient(c.id));
    li.appendChild(b);
    ul.appendChild(li);
  }
}

let clientTab = "settings"; // settings | analytics | calllog
let selectedClientCallId = null;

function selectClient(cid) {
  selectedClientId = cid;
  clientTab = "settings";
  selectedClientCallId = null;
  renderClientList();
  const c = clients.find((x) => x.id === cid);
  if (!c) return;
  const ed = $("#clientEditor");
  ed.innerHTML = `
    <div class="ctabs" role="tablist">
      <button class="ctab active" data-ctab="settings">Settings</button>
      <button class="ctab" data-ctab="analytics">Analytics</button>
      <button class="ctab" data-ctab="calllog">Call log</button>
    </div>
    <div class="ctab-body" id="ctabBody"></div>
  `;
  ed.querySelectorAll(".ctab").forEach((t) =>
    t.addEventListener("click", () => {
      clientTab = t.dataset.ctab;
      ed.querySelectorAll(".ctab").forEach((x) => x.classList.toggle("active", x === t));
      renderClientTab(cid);
    })
  );
  renderClientTab(cid);
}

function renderClientTab(cid) {
  const c = clients.find((x) => x.id === cid);
  if (!c) return;
  if (clientTab === "settings") renderClientSettings(c);
  else if (clientTab === "analytics") renderClientAnalytics(c);
  else renderClientCallLog(c);
}

/* ------------------------------ SETTINGS tab ----------------------------- */
function renderClientSettings(c) {
  const cid = c.id;
  const body = $("#ctabBody");
  body.innerHTML = `
    <div class="toggle-row ${c.instantCall ? "" : "disabled"}" id="toggleRow">
      <div>
        <strong>Instant call after submission</strong>
        <div class="sub">When a form for this client lands in AST, the agent dials the candidate within the calling window.</div>
      </div>
      <label class="switch">
        <input type="checkbox" id="f_instantCall" ${c.instantCall ? "checked" : ""} aria-label="Instant call after submission">
        <span></span>
      </label>
    </div>

    <div class="field"><label for="f_name">Client / agency name</label><input type="text" id="f_name" value="${esc(c.name)}"></div>

    <div class="field">
      <label for="f_instructions">AI agent instructions</label>
      <textarea id="f_instructions" spellcheck="false">${esc(c.instructions)}</textarea>
      <div class="sub">The agent's system prompt: who it represents, key facts (salary, shifts, requirements), and rules for the call. This is per-client, so each client's agent speaks for them.</div>
    </div>

    <div class="field">
      <label>Knowledge documents</label>
      <div class="sub">Upload a PDF, DOCX, TXT, or MD — the text is extracted and given to the agent alongside the instructions.</div>
      <ul class="kdocs" id="kdocs">${(c.knowledgeDocs || [])
        .map((d) => `<li><span>${esc(d.name)} <span class="meta">${(d.chars / 1000).toFixed(1)}k chars</span></span><button data-doc="${d.id}">Remove</button></li>`)
        .join("")}</ul>
      <p style="margin:10px 0 0"><input type="file" id="f_file" accept=".pdf,.docx,.txt,.md" aria-label="Upload knowledge document"></p>
      <p class="hint" id="uploadStatus"></p>
    </div>

    <details class="adv" open>
      <summary>Calling &amp; retry</summary>
      <div class="row2" style="margin-top:12px">
        <div class="field">
          <label for="f_outboundNumber">Outbound number</label>
          <input type="text" id="f_outboundNumber" value="${esc(c.outboundNumber)}">
          <div class="sub">A local-area-code number so candidates recognize the region.</div>
        </div>
        <div class="field"><label for="f_callWindowStart">Calling window start</label><input type="time" id="f_callWindowStart" value="${esc(c.callWindowStart)}"></div>
      </div>
      <div class="row3">
        <div class="field"><label for="f_callWindowEnd">Calling window end</label><input type="time" id="f_callWindowEnd" value="${esc(c.callWindowEnd)}"></div>
        <div class="field"><label for="f_maxAttempts">Max attempts</label><input type="number" id="f_maxAttempts" min="1" max="5" value="${c.maxAttempts}"></div>
        <div class="field"><label for="f_retryDelayMinutes">Retry delay (min)</label><input type="number" id="f_retryDelayMinutes" min="5" step="5" value="${c.retryDelayMinutes}"></div>
      </div>
    </details>

    <details class="adv">
      <summary>AST app integration</summary>
      <div class="field" style="margin-top:12px">
        <label for="f_astWebhookUrl">AST webhook URL (call results post here)</label>
        <input type="url" id="f_astWebhookUrl" value="${esc(c.astWebhookUrl)}" placeholder="https://ast.yourcompany.com/api/call-results">
        <div class="sub">When a call ends, First Ring posts the disposition, summary, and (later) pre-screen answers to this URL so AST updates the candidate record. Authenticated with the shared <span class="mono">X-AST-Key</span>.</div>
      </div>
      <p class="hint">Client ID for the AST submission hook: <span class="mono">${cid}</span></p>
    </details>

    <div class="editor-actions">
      <button class="btn" id="btnSave">Save changes</button>
      <button class="btn go" id="btnSimulate">Simulate a form submission</button>
      <button class="btn danger" id="btnDelete">Delete client</button>
      <span class="save-note" id="saveNote"></span>
    </div>
  `;

  $("#f_instantCall").addEventListener("change", (e) => {
    $("#toggleRow").classList.toggle("disabled", !e.target.checked);
  });

  $("#btnSave").addEventListener("click", async () => {
    const payload = {
      name: $("#f_name").value,
      outboundNumber: $("#f_outboundNumber").value,
      astWebhookUrl: $("#f_astWebhookUrl").value,
      instantCall: $("#f_instantCall").checked,
      callWindowStart: $("#f_callWindowStart").value,
      callWindowEnd: $("#f_callWindowEnd").value,
      maxAttempts: $("#f_maxAttempts").value,
      retryDelayMinutes: $("#f_retryDelayMinutes").value,
      instructions: $("#f_instructions").value,
    };
    const res = await fetch("/api/clients/" + cid, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      note("Saved");
      await loadClients();
    } else note("Save failed", true);
  });

  $("#btnSimulate").addEventListener("click", async () => {
    const res = await fetch("/api/demo/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: cid }),
    });
    const j = await res.json();
    if (res.ok) note(`Queued call to ${j.candidate.firstName} ${j.candidate.lastName} — check Analytics / Call log`);
    else note(j.error || "Couldn't queue", true);
  });

  $("#btnDelete").addEventListener("click", async () => {
    if (!confirm("Delete this client and its agent config?")) return;
    await fetch("/api/clients/" + cid, { method: "DELETE" });
    selectedClientId = null;
    $("#clientEditor").innerHTML = '<p class="empty">Select a client to edit its agent, or add a new one.</p>';
    loadClients();
  });

  $("#f_file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $("#uploadStatus").textContent = "Reading " + file.name + "…";
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/clients/${cid}/knowledge`, { method: "POST", body: fd });
    const j = await res.json();
    if (res.ok) {
      $("#uploadStatus").textContent = `Added ${j.name} (${(j.chars / 1000).toFixed(1)}k characters).`;
      await loadClients();
      renderClientSettings(clients.find((x) => x.id === cid));
    } else $("#uploadStatus").textContent = j.error || "Upload failed";
  });

  $("#kdocs").addEventListener("click", async (e) => {
    const docId = e.target.getAttribute("data-doc");
    if (!docId) return;
    await fetch(`/api/clients/${cid}/knowledge/${docId}`, { method: "DELETE" });
    await loadClients();
    renderClientSettings(clients.find((x) => x.id === cid));
  });

  function note(msg, bad) {
    const n = $("#saveNote");
    n.textContent = msg;
    n.style.color = bad ? "var(--red)" : "var(--line-green)";
    setTimeout(() => { if (n.textContent === msg) n.textContent = ""; }, 5000);
  }
}

/* ------------------------------ ANALYTICS tab ---------------------------- */
async function renderClientAnalytics(c) {
  const body = $("#ctabBody");
  body.innerHTML = '<p class="empty">Loading analytics…</p>';
  let a;
  try {
    a = await (await fetch(`/api/clients/${c.id}/analytics`)).json();
  } catch {
    body.innerHTML = '<p class="empty">Could not load analytics.</p>';
    return;
  }
  if (!a.total) {
    body.innerHTML = '<p class="empty">No calls yet for this client. Once calls run, metrics show up here.</p>';
    return;
  }
  const dispRows = Object.entries(a.byDisposition)
    .sort((x, y) => y[1] - x[1])
    .map(([d, n]) => {
      const pct = Math.round((n / a.total) * 100);
      return `<div class="disp-row">
        <span class="badge ${d}">${d.replace(/_/g, " ")}</span>
        <div class="disp-bar"><div class="disp-fill ${d}" style="width:${pct}%"></div></div>
        <span class="disp-num">${n} · ${pct}%</span>
      </div>`;
    })
    .join("");
  const maxDay = Math.max(1, ...Object.values(a.last7Days));
  const spark = Object.entries(a.last7Days)
    .map(([day, n]) => {
      const h = Math.round((n / maxDay) * 46) + 2;
      const label = new Date(day + "T00:00").toLocaleDateString([], { weekday: "narrow" });
      return `<div class="spark-col"><div class="spark-bar" style="height:${h}px" title="${n} on ${day}"></div><span>${label}</span></div>`;
    })
    .join("");

  body.innerHTML = `
    <div class="metric-grid">
      <div class="metric"><span class="m-num">${a.total}</span><span class="m-lbl">Total calls</span></div>
      <div class="metric"><span class="m-num">${a.connectRate}%</span><span class="m-lbl">Connect rate</span></div>
      <div class="metric"><span class="m-num">${a.interestRate}%</span><span class="m-lbl">Interested</span></div>
      <div class="metric"><span class="m-num">${a.avgDuration}s</span><span class="m-lbl">Avg duration</span></div>
      <div class="metric"><span class="m-num">${a.avgAttempts}</span><span class="m-lbl">Avg attempts</span></div>
    </div>

    <div class="analytics-block">
      <h3>Calls, last 7 days</h3>
      <div class="sparkline">${spark}</div>
    </div>

    <div class="analytics-block">
      <h3>Disposition breakdown</h3>
      <div class="disp-list">${dispRows}</div>
    </div>
  `;
}

/* ------------------------------ CALL LOG tab ----------------------------- */
async function renderClientCallLog(c) {
  const body = $("#ctabBody");
  body.innerHTML = '<p class="empty">Loading calls…</p>';
  let calls;
  try {
    calls = await (await fetch(`/api/clients/${c.id}/calls`)).json();
  } catch {
    body.innerHTML = '<p class="empty">Could not load calls.</p>';
    return;
  }
  if (!calls.length) {
    body.innerHTML = '<p class="empty">No calls yet for this client.</p>';
    return;
  }
  body.innerHTML = `
    <div class="cl-log">
      <table class="calls-table">
        <thead><tr><th>When</th><th>Candidate</th><th>Attempt</th><th>Disposition</th><th>AST</th></tr></thead>
        <tbody id="clCallRows"></tbody>
      </table>
      <div class="cl-detail" id="clCallDetail"><p class="empty">Select a call to read the transcript.</p></div>
    </div>
  `;
  const tb = $("#clCallRows");
  tb.innerHTML = calls
    .map((cl) => {
      const when = new Date(cl.endedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const who = esc(((cl.candidate.firstName || "") + " " + (cl.candidate.lastName || "")).trim() || cl.candidate.phone);
      return `<tr data-call="${cl.id}"><td class="mono">${when}</td><td>${who}</td><td class="mono">${cl.attempt}</td><td><span class="badge ${cl.disposition}">${cl.disposition.replace(/_/g, " ")}</span></td><td class="mono">${cl.astDelivery === "delivered" ? "✓" : "—"}</td></tr>`;
    })
    .join("");
  tb.addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-call]");
    if (!tr) return;
    tb.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
    tr.classList.add("selected");
    const call = await (await fetch("/api/calls/" + tr.dataset.call)).json();
    const who = ((call.candidate.firstName || "") + " " + (call.candidate.lastName || "")).trim();
    $("#clCallDetail").innerHTML = `
      <h2>${esc(who || call.candidate.phone)}</h2>
      <div class="detail-meta">attempt ${call.attempt} · ${call.durationSeconds}s · <span class="badge ${call.disposition}">${call.disposition.replace(/_/g, " ")}</span></div>
      ${call.summary ? `<div class="summary-block">${esc(call.summary)}</div>` : ""}
      ${call.transcript.length
        ? `<div class="transcript">` + call.transcript.map(([role, line]) => `<div class="turn ${role}"><span class="who">${role}</span><p>${esc(line)}</p></div>`).join("") + `</div>`
        : `<p class="empty">No conversation — the call wasn't answered.</p>`}
    `;
  });
}

async function createClient() {
  const res = await fetch("/api/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "New client", instantCall: false }),
  });
  const c = await res.json();
  await loadClients();
  setClientView("table");
  selectClient(c.id);
}
$("#btnNewClient").addEventListener("click", createClient);
$("#btnNewClientTop").addEventListener("click", createClient);

/* ------------------------- settings + theme + changes -------------------- */

let settings = { displayName: "", userName: "", theme: "blue" };

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "allstar" ? "allstar" : "blue";
}

function renderGreeting() {
  const g = $("#greeting");
  const name = settings.userName && settings.userName.trim();
  g.textContent = name ? `Hi, ${name}` : (settings.displayName ? settings.displayName : "");
}

async function loadSettings() {
  try {
    settings = await (await fetch("/api/settings")).json();
  } catch {}
  applyTheme(settings.theme);
  renderGreeting();
}

/* settings modal */
let pendingTheme = "blue";
function openSettings() {
  $("#s_displayName").value = settings.displayName || "";
  $("#s_userName").value = settings.userName || "";
  pendingTheme = settings.theme === "allstar" ? "allstar" : "blue";
  markThemeChoice(pendingTheme);
  $("#settingsModal").hidden = false;
}
function markThemeChoice(theme) {
  document.querySelectorAll(".theme-swatch").forEach((b) =>
    b.classList.toggle("selected", b.dataset.themeChoice === theme)
  );
}
document.querySelectorAll(".theme-swatch").forEach((b) => {
  b.addEventListener("click", () => {
    pendingTheme = b.dataset.themeChoice;
    markThemeChoice(pendingTheme);
    applyTheme(pendingTheme); // live preview
  });
});
$("#btnSettings").addEventListener("click", openSettings);
$("#btnSaveSettings").addEventListener("click", async () => {
  const body = {
    displayName: $("#s_displayName").value,
    userName: $("#s_userName").value,
    theme: pendingTheme,
  };
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    settings = await res.json();
    applyTheme(settings.theme);
    renderGreeting();
    const n = $("#settingsNote");
    n.textContent = "Saved";
    n.style.color = "var(--line-green)";
    setTimeout(() => { $("#settingsModal").hidden = true; n.textContent = ""; }, 700);
  }
});

/* changes modal */
$("#btnChanges").addEventListener("click", async () => {
  $("#changesModal").hidden = false;
  const list = $("#activityList");
  list.innerHTML = "";
  try {
    const acts = await (await fetch("/api/activity?limit=200")).json();
    $("#activityEmpty").style.display = acts.length ? "none" : "block";
    list.innerHTML = acts
      .map((a) => {
        const when = new Date(a.at).toLocaleString([], {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        });
        return `<li><span class="act-msg">${esc(a.message)}</span><span class="act-when">${when}</span></li>`;
      })
      .join("");
  } catch {}
});

/* close any modal via the × or clicking the backdrop */
document.querySelectorAll(".modal-backdrop").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.hasAttribute("data-close")) m.hidden = true;
  });
});

/* --------------------------------- calls ---------------------------------- */

async function refreshCalls() {
  try {
    const calls = await (await fetch("/api/calls")).json();
    $("#callCount").textContent = calls.length ? calls.length + " calls" : "";
    $("#callsEmpty").style.display = calls.length ? "none" : "block";
    const tb = $("#callRows");
    tb.innerHTML = calls
      .map((c) => {
        const when = new Date(c.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const who = esc(((c.candidate.firstName || "") + " " + (c.candidate.lastName || "")).trim() || c.candidate.phone);
        return `<tr data-call="${c.id}" class="${c.id === selectedCallId ? "selected" : ""}">
          <td class="mono">${when}</td>
          <td>${who}</td>
          <td>${esc(c.clientName)}</td>
          <td class="mono">${c.attempt}</td>
          <td><span class="badge ${c.disposition}">${c.disposition.replace(/_/g, " ")}</span></td>
          <td class="mono">${c.astDelivery === "delivered" ? "✓" : "—"}</td>
        </tr>`;
      })
      .join("");
  } catch {}
}

$("#callRows").addEventListener("click", async (e) => {
  const tr = e.target.closest("tr[data-call]");
  if (!tr) return;
  selectedCallId = tr.getAttribute("data-call");
  refreshCalls();
  const call = await (await fetch("/api/calls/" + selectedCallId)).json();
  const d = $("#callDetail");
  const who = ((call.candidate.firstName || "") + " " + (call.candidate.lastName || "")).trim();
  d.innerHTML = `
    <h2>${esc(who || call.candidate.phone)}</h2>
    <div class="detail-meta">${esc(call.clientName)} · ${esc(call.candidate.position)} · attempt ${call.attempt} · ${call.durationSeconds}s · <span class="badge ${call.disposition}">${call.disposition.replace(/_/g, " ")}</span></div>
    <div class="summary-block">${esc(call.summary)}</div>
    ${call.transcript.length
      ? `<div class="transcript">` +
        call.transcript
          .map(([role, line]) => `<div class="turn ${role}"><span class="who">${role}</span><p>${esc(line)}</p></div>`)
          .join("") +
        `</div>`
      : `<p class="empty">No conversation — the call wasn't answered.</p>`}
  `;
});

/* --------------------------------- setup ---------------------------------- */

async function loadSetup() {
  const info = await (await fetch("/api/integration")).json();
  const cid = clients[0] ? clients[0].id : "cl_xxxxxxxxxx";
  $("#curlIn").textContent = `POST ${info.base}/api/hooks/submission
Header  X-AST-Key: {shared key}
Header  Content-Type: application/json

{
  "clientId": "${cid}",
  "candidate": {
    "firstName": "Jordan",
    "lastName": "Reyes",
    "phone": "+19195550142",
    "position": "Corrections Officer",
    "astRecordId": "the AST candidate record id"
  }
}`;
  $("#keyHint").textContent = info.sharedKeyHint;
}

/* --------------------------------- utils ---------------------------------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

/* ---------------------------------- init ---------------------------------- */

(async () => {
  await loadSettings();
  setClientView("panels");
  await loadClients();
  await loadSetup();
  refreshCalls();
  refreshClientStats();
  setInterval(refreshCalls, 3000);
  setInterval(refreshClientStats, 2000);
})();
