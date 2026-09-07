let clients = [];
let selectedClientId = null;
let selectedCallId = null;

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
  if (selectedClientId && !clients.find((c) => c.id === selectedClientId)) {
    selectedClientId = null;
    $("#clientEditor").innerHTML = '<p class="empty">Select a client to edit its agent, or add a new one.</p>';
  }
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

function selectClient(cid) {
  selectedClientId = cid;
  renderClientList();
  const c = clients.find((x) => x.id === cid);
  if (!c) return;
  const ed = $("#clientEditor");
  ed.innerHTML = `
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

    <div class="row2">
      <div class="field"><label for="f_name">Client / agency name</label><input type="text" id="f_name" value="${esc(c.name)}"></div>
      <div class="field"><label for="f_position">Position</label><input type="text" id="f_position" value="${esc(c.position)}"></div>
    </div>
    <div class="row2">
      <div class="field">
        <label for="f_outboundNumber">Outbound number</label>
        <input type="text" id="f_outboundNumber" value="${esc(c.outboundNumber)}">
        <div class="sub">Buy a local-area-code number in Twilio per client so candidates recognize the region.</div>
      </div>
      <div class="field">
        <label for="f_astWebhookUrl">AST webhook URL (results go here)</label>
        <input type="url" id="f_astWebhookUrl" value="${esc(c.astWebhookUrl)}" placeholder="https://ast.yourcompany.com/api/call-results">
      </div>
    </div>
    <div class="row3">
      <div class="field"><label for="f_callWindowStart">Calling window start</label><input type="time" id="f_callWindowStart" value="${esc(c.callWindowStart)}"></div>
      <div class="field"><label for="f_callWindowEnd">Calling window end</label><input type="time" id="f_callWindowEnd" value="${esc(c.callWindowEnd)}"></div>
      <div class="field"><label for="f_maxAttempts">Max attempts</label><input type="number" id="f_maxAttempts" min="1" max="5" value="${c.maxAttempts}"></div>
    </div>
    <div class="row3">
      <div class="field"><label for="f_retryDelayMinutes">Retry delay (minutes)</label><input type="number" id="f_retryDelayMinutes" min="5" step="5" value="${c.retryDelayMinutes}"></div>
    </div>

    <div class="field">
      <label for="f_instructions">Agent instructions</label>
      <textarea id="f_instructions" spellcheck="false">${esc(c.instructions)}</textarea>
      <div class="sub">This becomes the agent's system prompt: who it represents, key facts (salary, shifts, requirements), and rules for the call.</div>
    </div>

    <div class="field">
      <label>Knowledge documents</label>
      <div class="sub">Upload a PDF, DOCX, TXT, or MD — the text is extracted and given to the agent alongside the instructions.</div>
      <ul class="kdocs" id="kdocs">${(c.knowledgeDocs || [])
        .map(
          (d) => `<li><span>${esc(d.name)} <span class="meta">${(d.chars / 1000).toFixed(1)}k chars</span></span><button data-doc="${d.id}">Remove</button></li>`
        )
        .join("")}</ul>
      <p style="margin:10px 0 0"><input type="file" id="f_file" accept=".pdf,.docx,.txt,.md" aria-label="Upload knowledge document"></p>
      <p class="hint" id="uploadStatus"></p>
    </div>

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
    const body = {
      name: $("#f_name").value,
      position: $("#f_position").value,
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
      body: JSON.stringify(body),
    });
    if (res.ok) {
      note("Saved");
      await loadClients();
      renderClientList();
    } else {
      note("Save failed", true);
    }
  });

  $("#btnSimulate").addEventListener("click", async () => {
    const res = await fetch("/api/demo/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: cid }),
    });
    const j = await res.json();
    if (res.ok) {
      note(`Queued call to ${j.candidate.firstName} ${j.candidate.lastName} — watch the lamps, then the call log`);
    } else {
      note(j.error || "Couldn't queue", true);
    }
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
      $("#uploadStatus").textContent = `Added ${j.name} (${(j.chars / 1000).toFixed(1)}k characters of text).`;
      await loadClients();
      selectClient(cid);
    } else {
      $("#uploadStatus").textContent = j.error || "Upload failed";
    }
  });

  $("#kdocs").addEventListener("click", async (e) => {
    const docId = e.target.getAttribute("data-doc");
    if (!docId) return;
    await fetch(`/api/clients/${cid}/knowledge/${docId}`, { method: "DELETE" });
    await loadClients();
    selectClient(cid);
  });

  function note(msg, bad) {
    const n = $("#saveNote");
    n.textContent = msg;
    n.style.color = bad ? "var(--red)" : "var(--line-green)";
    setTimeout(() => { if (n.textContent === msg) n.textContent = ""; }, 5000);
  }
}

$("#btnNewClient").addEventListener("click", async () => {
  const res = await fetch("/api/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "New client", instantCall: false }),
  });
  const c = await res.json();
  await loadClients();
  selectClient(c.id);
});

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
  await loadClients();
  await loadSetup();
  refreshCalls();
  setInterval(refreshCalls, 3000);
})();
