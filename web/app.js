// ccglass dashboard SPA. Vanilla JS, no build step.

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmt = (n) => (n == null ? "—" : n.toLocaleString());

const state = { session: null, live: null, entries: [], selected: null, tab: "overview", diff: false, picks: [] };

async function api(path) {
  const r = await fetch(path);
  return r.json();
}

// ---- sessions + list -----------------------------------------------------

async function loadSessions() {
  const { sessions, live } = await api("/api/sessions");
  state.live = live;
  const sel = $("#session");
  sel.innerHTML = "";
  for (const s of sessions) {
    sel.append(el("option", { value: s, textContent: s + (s === live ? "  (live)" : "") }));
  }
  state.session = state.session || live || sessions[0] || null;
  if (state.session) sel.value = state.session;
  $("#live").classList.toggle("off", !live);
  await loadList();
}

async function loadList() {
  if (!state.session) return;
  const { entries } = await api("/api/requests?session=" + encodeURIComponent(state.session));
  state.entries = entries;
  renderList();
}

function renderList() {
  const list = $("#list");
  list.innerHTML = "";
  for (const e of state.entries) {
    const row = el("div", { className: "row" });
    if (e.id === state.selected) row.classList.add("sel");
    if (state.picks.includes(e.id)) row.classList.add("pick");
    row.append(
      el("div", { className: "top" },
        el("span", { className: "seq", textContent: "#" + e.seq }),
        el("span", { textContent: e.model || "—" })),
      el("div", { className: "sub" },
        el("span", { textContent: `${e.format ? e.format + " · " : ""}${e.nMessages} msg · ${e.nTools} tools · ` }),
        el("span", { className: e.pending ? "pending" : "", textContent: e.pending ? "pending…" : "HTTP " + e.status }))
    );
    row.onclick = () => onPick(e.id);
    list.append(row);
  }
}

function onPick(id) {
  if (state.diff) {
    state.picks = state.picks.includes(id) ? state.picks.filter((x) => x !== id) : [...state.picks, id].slice(-2);
    if (state.picks.length === 2) renderDiff();
    renderList();
    return;
  }
  state.selected = id;
  renderList();
  loadDetail(id);
}

// ---- detail --------------------------------------------------------------

async function loadDetail(id) {
  const rec = await api("/api/request/" + encodeURIComponent(id));
  state.detail = rec;
  renderDetail();
}

const TABS = ["overview", "system", "messages", "tools", "response", "headers"];

function renderDetail() {
  const rec = state.detail;
  const d = $("#detail");
  d.innerHTML = "";
  const tabs = el("div", { className: "tabs" });
  for (const t of TABS) {
    const tab = el("div", { className: "tab" + (t === state.tab ? " on" : ""), textContent: t });
    tab.onclick = () => { state.tab = t; renderDetail(); };
    tabs.append(tab);
  }
  d.append(tabs);
  const pane = el("div", { className: "pane" });
  pane.innerHTML = paneHtml(rec, state.tab);
  d.append(pane);
}

function paneHtml(rec, tab) {
  const parsed = rec.parsed || {};
  const view = parsed.view || { system: [], messages: [], tools: [] };
  if (tab === "overview") return overviewHtml(rec, parsed, view);
  if (tab === "system") return blocksHtml(view.system);
  if (tab === "messages") return messagesHtml(view.messages);
  if (tab === "tools") return toolsHtml(view.tools);
  if (tab === "response") return responseHtml(parsed.response);
  if (tab === "headers") return blockEl("headers", JSON.stringify(rec.request?.headers || {}, null, 2));
  return "";
}

function overviewHtml(rec, parsed, view) {
  const c = parsed.cost || {};
  const u = parsed.response?.usage || {};
  const body = rec.request?.body || {};
  const dl = (f) => `<a class="dl" href="/api/export?id=${encodeURIComponent(rec.id)}&format=${f}">⬇ ${f}</a>`;
  return `
    <div class="cards">
      ${card("format", parsed.format || rec.format || "—")}
      ${card("model", body.model || "—")}
      ${card("est. input", "≈" + fmt(parsed.estTokens), "tokens")}
      ${card("actual input", fmt(u.input_tokens), "tokens")}
      ${card("output", fmt(u.output_tokens), "tokens")}
      ${card("cache read", fmt(c.cacheRead), (Math.round((c.cacheHitRate || 0) * 100)) + "% hit")}
      ${card("cache write", fmt(c.cacheWrite), "tokens")}
      ${card("cost", "$" + (c.usd || 0).toFixed(5))}
      ${card("stop", parsed.response?.stop_reason || "—")}
    </div>
    <div>${dl("md")}${dl("json")}${dl("har")}</div>
    <div class="block"><div class="h">request line</div><pre>${esc(rec.request?.method)} ${esc(rec.request?.url)}</pre></div>
    <p style="color:var(--muted)">${view.system.length} system blocks · ${view.messages.length} messages · ${view.tools.length} tools</p>`;
}

function card(k, v, sub) {
  return `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}${sub ? ` <small>${esc(sub)}</small>` : ""}</div></div>`;
}

function blockEl(label, text, tags = "") {
  return `<div class="block"><div class="h"><span>${esc(label)}</span><span>${tags}</span></div><pre>${esc(text)}</pre></div>`;
}

function blocksHtml(blocks) {
  if (!blocks.length) return `<p style="color:var(--muted)">none</p>`;
  return blocks.map((b) => blockEl(b.label, b.text, b.cache ? '<span class="tag cache">cache 1h</span>' : "")).join("");
}

function messagesHtml(messages) {
  if (!messages.length) return `<p style="color:var(--muted)">none</p>`;
  return messages.map((m) => {
    const tags = [];
    if (m.cache) tags.push('<span class="tag cache">cache 1h</span>');
    if (m.type && m.type !== "text" && m.type !== "message") tags.push(`<span class="tag tool">${esc(m.type)}</span>`);
    return blockEl(m.label, m.text, tags.join(""));
  }).join("");
}

function toolsHtml(tools) {
  if (!tools.length) return `<p style="color:var(--muted)">none</p>`;
  return tools.map((t) =>
    `<div class="block"><div class="h"><span>${esc(t.name)}</span></div>` +
    `<pre>${esc(t.description || "")}\n\n— schema —\n${esc(JSON.stringify(t.schema || {}, null, 2))}</pre></div>`
  ).join("");
}

function responseHtml(r) {
  if (!r) return `<p style="color:var(--muted)">no response captured</p>`;
  let html = blockEl("usage", JSON.stringify(r.usage || {}, null, 2), r.streamed ? '<span class="tag tool">streamed</span>' : "");
  for (const b of r.content || []) {
    const label = b.type === "tool_use" ? `tool_use: ${b.name}` : b.type;
    const text = b.type === "tool_use" ? JSON.stringify(b.input, null, 2) : (b.text ?? b.thinking ?? JSON.stringify(b));
    html += blockEl(label, text);
  }
  if (r.error) html += blockEl("error", JSON.stringify(r.error, null, 2));
  return html;
}

// ---- diff ----------------------------------------------------------------

async function renderDiff() {
  const [a, b] = state.picks;
  const diff = await api(`/api/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  const d = $("#detail");
  d.innerHTML = "";
  const pane = el("div", { className: "pane" });
  if (diff.error) { pane.innerHTML = `<p>${esc(diff.error)}</p>`; d.append(pane); return; }
  const c = diff.counts;
  pane.innerHTML =
    `<div class="cards">
      ${card("added", "+" + c.added, "blocks")}
      ${card("removed", "−" + c.removed, "blocks")}
      ${card("unchanged", c.common, "blocks")}
      ${card("cached in B", c.cachedInB, "blocks")}
     </div>
     <p style="color:var(--muted)">Comparing <b>${esc(a)}</b> → <b>${esc(b)}</b> (later request B vs earlier A)</p>` +
    `<div class="diff-section add">＋ Added in B (new context this turn)</div>` +
    (diff.added.map((x) => diffBlock(x, "add")).join("") || `<p style="color:var(--muted)">nothing new</p>`) +
    `<div class="diff-section del">− Removed since A</div>` +
    (diff.removed.map((x) => diffBlock(x, "del")).join("") || `<p style="color:var(--muted)">nothing removed</p>`);
  d.append(pane);
}

function diffBlock(x, kind) {
  const tag = x.cache ? '<span class="tag cache">cache</span>' : "";
  return `<div class="block diff-${kind}"><div class="h"><span>${esc(x.label)}</span><span>${tag}</span></div><pre>${esc((x.text || "").slice(0, 4000))}</pre></div>`;
}

// ---- live + wiring -------------------------------------------------------

function connectStream() {
  try {
    const es = new EventSource("/api/stream");
    es.onmessage = (ev) => {
      const s = JSON.parse(ev.data);
      if (s.session !== (state.session || state.live)) return;
      const i = state.entries.findIndex((e) => e.id === s.id);
      if (i >= 0) state.entries[i] = s;
      else state.entries.push(s);
      renderList();
      if (s.id === state.selected) loadDetail(s.id);
    };
  } catch {}
}

$("#session").onchange = (e) => { state.session = e.target.value; state.picks = []; loadList(); };
$("#diffBtn").onclick = (e) => {
  state.diff = !state.diff;
  state.picks = [];
  e.target.textContent = "Diff: " + (state.diff ? "pick 2" : "off");
  e.target.classList.toggle("on", state.diff);
  renderList();
  if (!state.diff && state.selected) loadDetail(state.selected);
};

loadSessions().then(connectStream);
