let clients = [];
let selectedClientId = null;
let selectedCallId = null;
let clientView = "panels"; // "panels" | "table"
let clientStats = {};
let clientTab = "settings"; // settings | analytics | calllog | embed | astimport

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
  renderClientPanels();
  renderClientTable();
}

/* -------- list mode: panels vs real table -------- */
function setClientView(mode) {
  clientView = mode;
  $("#clientPanels").hidden = mode !== "panels";
  $("#clientTableWrap").hidden = mode !== "table";
  $("#vtPanels").classList.toggle("active", mode === "panels");
  $("#vtTable").classList.toggle("active", mode === "table");
}
$("#vtPanels").addEventListener("click", () => setClientView("panels"));
$("#vtTable").addEventListener("click", () => setClientView("table"));

/* -------- switch between the list and a single client's detail page -------- */
function showListMode() {
  selectedClientId = null;
  $("#clientListMode").hidden = false;
  $("#clientDetailMode").hidden = true;
}
function openClientDetail(cid) {
  const c = clients.find((x) => x.id === cid);
  if (!c) return;
  selectedClientId = cid;
  clientTab = "settings";
  $("#clientListMode").hidden = true;
  $("#clientDetailMode").hidden = false;
  $("#detailName").textContent = c.name;
  $("#detailSub").textContent = (c.instantCall ? "Instant call on" : "Instant call off");
  document.querySelectorAll("#clientDetailMode .ctab").forEach((t) =>
    t.classList.toggle("active", t.dataset.ctab === "settings")
  );
  renderClientTab(cid);
}
$("#btnBackToList").addEventListener("click", () => { showListMode(); loadClients(); });
document.querySelectorAll("#clientDetailMode .ctab").forEach((t) =>
  t.addEventListener("click", () => {
    clientTab = t.dataset.ctab;
    document.querySelectorAll("#clientDetailMode .ctab").forEach((x) => x.classList.toggle("active", x === t));
    renderClientTab(selectedClientId);
  })
);

/* -------- panel cards -------- */
function renderClientPanels() {
  const wrap = $("#clientPanels");
  if (!clients.length) {
    wrap.innerHTML = '<p class="empty" style="color:#fff">No clients yet. Press “Add client” to create one.</p>';
    return;
  }
  wrap.innerHTML = clients
    .map((c) => {
      const s = clientStats[c.id] || { active: 0, queued: 0, total: 0 };
      const callState = s.active > 0
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
  wrap.querySelectorAll(".pcard").forEach((card) =>
    card.addEventListener("click", () => openClientDetail(card.dataset.client))
  );
}

/* -------- real data table -------- */
function renderClientTable() {
  const tb = $("#clientTableRows");
  if (!clients.length) {
    tb.innerHTML = '<tr><td colspan="7" class="empty">No clients yet.</td></tr>';
    return;
  }
  tb.innerHTML = clients
    .map((c) => {
      const s = clientStats[c.id] || { active: 0, queued: 0, total: 0 };
      const live = s.active > 0
        ? `<span class="tbl-live active"><span class="dot"></span>${s.active}</span>`
        : `<span class="tbl-live"><span class="dot"></span>0</span>`;
      return `<tr data-client="${c.id}">
        <td class="tbl-name">${esc(c.name)}</td>
        <td>${esc(c.position || "—")}</td>
        <td>${c.instantCall ? '<span class="tbl-on">On</span>' : '<span class="tbl-offbadge">Off</span>'}</td>
        <td>${live}</td>
        <td class="mono">${s.total}</td>
        <td class="mono">${s.queued}</td>
        <td class="tbl-open">Open →</td>
      </tr>`;
    })
    .join("");
  tb.querySelectorAll("tr[data-client]").forEach((row) =>
    row.addEventListener("click", () => openClientDetail(row.dataset.client))
  );
}

async function refreshClientStats() {
  try {
    clientStats = await (await fetch("/api/client-stats")).json();
    if (!$("#clientListMode").hidden) {
      if (clientView === "panels") renderClientPanels();
      else renderClientTable();
    }
  } catch {}
}

function renderClientTab(cid) {
  const c = clients.find((x) => x.id === cid);
  if (!c) return;
  if (clientTab === "settings") renderClientSettings(c);
  else if (clientTab === "analytics") renderClientAnalytics(c);
  else if (clientTab === "calllog") renderClientCallLog(c);
  else if (clientTab === "embed") renderClientEmbed(c);
  else if (clientTab === "astimport") renderClientAstImport(c);
}

let selectedClientCallId = null;

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

    <details class="adv">
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
      clients = await (await fetch("/api/clients")).json();
      const fresh = clients.find((x) => x.id === cid);
      if (fresh) {
        $("#detailName").textContent = fresh.name;
        $("#detailSub").textContent = fresh.instantCall ? "Instant call on" : "Instant call off";
      }
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
    showListMode();
    await loadClients();
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

/* ------------------------------ HTML EMBED tab --------------------------- */
function renderClientEmbed(c) {
  const body = $("#ctabBody");
  const base = window.location.origin;
  const snippet = buildEmbedSnippet(c.id, c.name, base);
  body.innerHTML = `
    <p class="tab-intro">Drop a <strong>Code / Embed</strong> block into the client's Webflow page and paste this. It renders a lead form that talks directly to First Ring — when someone submits with the phone-call box ticked, First Ring calls them. No AST app or Zapier needed.</p>
    <div class="field">
      <label>Webflow embed code</label>
      <textarea id="embedCode" class="code-area" readonly spellcheck="false">${esc(snippet)}</textarea>
    </div>
    <div class="editor-actions">
      <button class="btn" id="btnCopyEmbed">Copy code</button>
      <span class="save-note" id="embedNote"></span>
    </div>
    <p class="hint">The form posts to <span class="mono">${base}/api/embed/${c.id}/submit</span>. The phone-call opt-in checkbox is the candidate's consent and is stored with the call.</p>
  `;
  $("#btnCopyEmbed").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      const n = $("#embedNote"); n.textContent = "Copied"; n.style.color = "var(--line-green)";
      setTimeout(() => (n.textContent = ""), 1500);
    } catch {
      $("#embedCode").select();
    }
  });
}

function buildEmbedSnippet(cid, name, base) {
  return `<!-- First Ring lead form for ${name} -->
<div id="fr-form-${cid}"></div>
<script>
(function(){
  var C = document.getElementById("fr-form-${cid}");
  C.innerHTML =
    '<form id="frf-${cid}" style="max-width:520px;font-family:inherit">'
    + '<input name="firstName" placeholder="First name" required style="display:block;width:100%;margin:0 0 10px;padding:10px;border:1px solid #ccc;border-radius:6px">'
    + '<input name="lastName" placeholder="Last name" style="display:block;width:100%;margin:0 0 10px;padding:10px;border:1px solid #ccc;border-radius:6px">'
    + '<input name="phone" placeholder="Phone number" required style="display:block;width:100%;margin:0 0 10px;padding:10px;border:1px solid #ccc;border-radius:6px">'
    + '<input name="company_website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">'
    + '<label style="display:flex;gap:8px;align-items:flex-start;margin:0 0 14px;font-size:14px">'
    + '<input type="checkbox" name="phoneOptIn" style="margin-top:3px">'
    + '<span>It\\'s okay to call me about this position, including with an automated assistant. Message/data rates may apply.</span></label>'
    + '<button type="submit" style="padding:11px 18px;border:0;border-radius:6px;background:#3b5b8c;color:#fff;font-weight:600;cursor:pointer">Apply now</button>'
    + '<p id="frf-msg-${cid}" style="margin:10px 0 0;font-size:14px"></p>'
    + '</form>';
  document.getElementById("frf-${cid}").addEventListener("submit", function(e){
    e.preventDefault();
    var f = e.target, msg = document.getElementById("frf-msg-${cid}");
    var body = {
      firstName: f.firstName.value, lastName: f.lastName.value,
      phone: f.phone.value, phoneOptIn: f.phoneOptIn.checked,
      company_website: f.company_website.value
    };
    fetch("${base}/api/embed/${cid}/submit", {
      method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)
    }).then(function(r){ return r.json(); }).then(function(){
      msg.textContent = "Thanks! We'll be in touch shortly.";
      msg.style.color = "#0a7d3f"; f.reset();
    }).catch(function(){
      msg.textContent = "Something went wrong. Please try again.";
      msg.style.color = "#c0392b";
    });
  });
})();
<\/script>`;
}

/* --------------------------- AST APP IMPORT tab -------------------------- */
function renderClientAstImport(c) {
  const body = $("#ctabBody");
  const imp = c.astImport || { embedKey: "", zapierUrl: "", origin: "", prescreen: [] };
  const rows = (imp.prescreen || [])
    .map((q, qi) => renderPrescreenRow(q, qi))
    .join("");
  body.innerHTML = `
    <p class="tab-intro">Connect this client's calls back to the AST app. The bot asks each pre-screen question in a friendly interview style, and based on the candidate's answer, First Ring sends the matching tag slug to the AST app — no Zapier step.</p>

    <div class="row2">
      <div class="field">
        <label for="ai_embedKey">AST EmbedKey</label>
        <input type="text" id="ai_embedKey" value="${esc(imp.embedKey)}" placeholder="e.g. 8fa85f6caead4d74a8afe9dda920fd94">
        <div class="sub">From the AST form's embed snippet / Zapier block.</div>
      </div>
      <div class="field">
        <label for="ai_origin">Origin (accepted domain)</label>
        <input type="text" id="ai_origin" value="${esc(imp.origin)}" placeholder="https://www.joindmh.us">
      </div>
    </div>
    <div class="field">
      <label for="ai_zapierUrl">AST endpoint</label>
      <input type="url" id="ai_zapierUrl" value="${esc(imp.zapierUrl)}">
      <div class="sub">Where results are posted. Leave as-is unless AST changes it.</div>
    </div>

    <h3 class="section-h">Pre-screen questions</h3>
    <div id="prescreenList">${rows || '<p class="empty">No questions yet. Add one below.</p>'}</div>
    <button class="btn ghost small" id="btnAddQ">+ Add question</button>

    <div class="editor-actions" style="margin-top:22px">
      <button class="btn" id="btnSaveImport">Save</button>
      <span class="save-note" id="importNote"></span>
    </div>

    <details class="adv" style="margin-top:24px">
      <summary>AST app integration (call result webhook)</summary>
      <div class="field" style="margin-top:12px">
        <label for="f_astWebhookUrl">AST webhook URL (call results also post here)</label>
        <input type="url" id="f_astWebhookUrl" value="${esc(c.astWebhookUrl)}" placeholder="https://ast.yourcompany.com/api/call-results">
        <div class="sub">Optional. When a call ends, First Ring can also POST the disposition + summary here (authenticated with <span class="mono">X-AST-Key</span>). The slug write-back above is the primary path; this is for clients who also want the raw result.</div>
      </div>
      <p class="hint">This client's ID for the AST submission hook: <span class="mono">${c.id}</span></p>
    </details>
  `;

  $("#btnAddQ").addEventListener("click", () => {
    const list = $("#prescreenList");
    if (list.querySelector(".empty")) list.innerHTML = "";
    const idx = list.querySelectorAll(".pq").length;
    list.insertAdjacentHTML("beforeend", renderPrescreenRow({ question: "", answers: [{ label: "", slug: "", expected: true }] }, idx));
    bindPrescreenRow(list.lastElementChild);
  });

  $("#prescreenList").querySelectorAll(".pq").forEach(bindPrescreenRow);

  $("#btnSaveImport").addEventListener("click", async () => {
    const prescreen = collectPrescreen();
    const astImport = {
      embedKey: $("#ai_embedKey").value.trim(),
      origin: $("#ai_origin").value.trim(),
      zapierUrl: $("#ai_zapierUrl").value.trim(),
      prescreen,
    };
    const res = await fetch("/api/clients/" + c.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ astImport, astWebhookUrl: $("#f_astWebhookUrl").value }),
    });
    const n = $("#importNote");
    if (res.ok) {
      clients = await (await fetch("/api/clients")).json();
      n.textContent = "Saved"; n.style.color = "var(--line-green)";
    } else { n.textContent = "Save failed"; n.style.color = "var(--red)"; }
    setTimeout(() => (n.textContent = ""), 1500);
  });
}

function renderPrescreenRow(q, qi) {
  const answers = (q.answers && q.answers.length ? q.answers : [{ label: "", slug: "", expected: true }])
    .map((a) => `
      <div class="pa-row">
        <input class="pa-label" placeholder="Answer (e.g. Yes)" value="${esc(a.label || "")}">
        <input class="pa-slug mono" placeholder="tag slug (opt-… / grp-…)" value="${esc(a.slug || "")}">
        <label class="pa-exp"><input type="checkbox" class="pa-expected" ${a.expected ? "checked" : ""}> expected</label>
        <button class="pa-del" title="Remove answer">×</button>
      </div>`)
    .join("");
  return `
    <div class="pq">
      <div class="pq-head">
        <input class="pq-question" placeholder="Question the bot asks (e.g. Are you at least 21 years old?)" value="${esc(q.question || "")}">
        <button class="pq-del" title="Remove question">Remove</button>
      </div>
      <div class="pa-list">${answers}</div>
      <button class="pa-add btn ghost small">+ Add answer</button>
    </div>`;
}

function bindPrescreenRow(row) {
  row.querySelector(".pq-del").addEventListener("click", () => {
    row.remove();
    const list = $("#prescreenList");
    if (!list.querySelector(".pq")) list.innerHTML = '<p class="empty">No questions yet. Add one below.</p>';
  });
  row.querySelector(".pa-add").addEventListener("click", () => {
    row.querySelector(".pa-list").insertAdjacentHTML("beforeend", `
      <div class="pa-row">
        <input class="pa-label" placeholder="Answer (e.g. No)">
        <input class="pa-slug mono" placeholder="tag slug (opt-… / grp-…)">
        <label class="pa-exp"><input type="checkbox" class="pa-expected"> expected</label>
        <button class="pa-del" title="Remove answer">×</button>
      </div>`);
    bindAnswerDeletes(row);
  });
  bindAnswerDeletes(row);
}
function bindAnswerDeletes(row) {
  row.querySelectorAll(".pa-del").forEach((b) => {
    b.onclick = () => b.closest(".pa-row").remove();
  });
}
function collectPrescreen() {
  const out = [];
  document.querySelectorAll("#prescreenList .pq").forEach((row) => {
    const question = row.querySelector(".pq-question").value.trim();
    if (!question) return;
    const answers = [];
    row.querySelectorAll(".pa-row").forEach((ar) => {
      const label = ar.querySelector(".pa-label").value.trim();
      const slug = ar.querySelector(".pa-slug").value.trim();
      if (!label && !slug) return;
      answers.push({ label, slug, expected: ar.querySelector(".pa-expected").checked });
    });
    out.push({ id: "q_" + Math.random().toString(36).slice(2, 8), question, answers });
  });
  return out;
}

async function createClient() {
  const res = await fetch("/api/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "New client", instantCall: false }),
  });
  const c = await res.json();
  await loadClients();
  openClientDetail(c.id);
}
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

/* --------------------------------- utils ---------------------------------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

/* ---------------------------------- init ---------------------------------- */

(async () => {
  await loadSettings();
  setClientView("panels");
  await loadClients();
  refreshCalls();
  refreshClientStats();
  setInterval(refreshCalls, 3000);
  setInterval(refreshClientStats, 2000);
})();
