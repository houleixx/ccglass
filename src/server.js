// Dashboard web server: serves the SPA, exposes a small REST API over the
// captured logs, and pushes new entries live over SSE. All format-specific
// work is delegated to the adapter chosen per entry (anthropic | openai).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarize, listSessions, loadSession, readEntryById } from "./store.js";
import { getAdapter, detectFormat } from "./formats/index.js";
import { diffBlockLists } from "./diff.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "..", "web");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

// `store` is present in live (`ccglass claude`) mode; otherwise we read from disk.
export function createServer({ root, store }) {
  const sseClients = new Set();

  if (store) {
    const push = (rec) => {
      const data = `data: ${JSON.stringify(summarize(rec))}\n\n`;
      for (const res of sseClients) res.write(data);
    };
    store.on("entry", push);
    store.on("update", push);
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;

    try {
      if (p === "/api/sessions") return json(res, apiSessions(root, store));
      if (p === "/api/requests") return json(res, apiRequests(root, store, url));
      if (p.startsWith("/api/request/")) return json(res, apiRequest(root, store, decodeURIComponent(p.slice("/api/request/".length))));
      if (p === "/api/diff") return json(res, apiDiff(root, store, url));
      if (p === "/api/export") return apiExport(root, store, url, res);
      if (p === "/api/stream") return stream(res, sseClients);
      return serveStatic(p, res);
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
  });
}

// ---- API handlers --------------------------------------------------------

function getEntry(root, store, id) {
  if (store) {
    const live = store.get(id);
    if (live) return live;
  }
  return readEntryById(root, id);
}

function apiSessions(root, store) {
  return { sessions: listSessions(root), live: store ? store.sessionId : null };
}

function apiRequests(root, store, url) {
  const session = url.searchParams.get("session");
  if (store && (!session || session === store.sessionId)) return { entries: store.list() };
  if (!session) return { entries: [] };
  return { entries: loadSession(root, session).map(summarize) };
}

function apiRequest(root, store, id) {
  const rec = getEntry(root, store, id);
  if (!rec) return { error: "not found" };
  const fmt = detectFormat(rec);
  const A = getAdapter(fmt);
  const body = rec.request?.body || {};
  const response = rec.response?.raw ? A.reassemble(rec.response.raw) : rec.response;
  const usage = response?.usage || {};
  return {
    ...rec,
    format: fmt,
    parsed: {
      format: fmt,
      view: A.view(body),
      response,
      estTokens: A.estimateTokens(body),
      cost: A.cost(body.model, usage),
    },
  };
}

function apiDiff(root, store, url) {
  const a = getEntry(root, store, url.searchParams.get("a"));
  const b = getEntry(root, store, url.searchParams.get("b"));
  if (!a || !b) return { error: "need both a and b" };
  const blocksA = getAdapter(detectFormat(a)).blocks(a.request?.body || {});
  const blocksB = getAdapter(detectFormat(b)).blocks(b.request?.body || {});
  return diffBlockLists(blocksA, blocksB);
}

function apiExport(root, store, url, res) {
  const id = url.searchParams.get("id");
  const format = url.searchParams.get("format") || "md";
  const rec = getEntry(root, store, id);
  if (!rec) return json(res, { error: "not found" }, 404);

  if (format === "json") {
    res.writeHead(200, { "content-type": "application/json", ...attach(id, "json") });
    return res.end(JSON.stringify(rec, null, 2));
  }
  if (format === "har") {
    res.writeHead(200, { "content-type": "application/json", ...attach(id, "har.json") });
    return res.end(JSON.stringify(toHar(rec), null, 2));
  }
  res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", ...attach(id, "md") });
  return res.end(toMarkdown(rec));
}

// ---- helpers -------------------------------------------------------------

function json(res, obj, code = 200) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function stream(res, clients) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(": connected\n\n");
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

function serveStatic(p, res) {
  const file = p === "/" ? "index.html" : p.replace(/^\//, "");
  const full = path.join(WEB_DIR, file);
  if (!full.startsWith(WEB_DIR) || !fs.existsSync(full)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream" });
  fs.createReadStream(full).pipe(res);
}

function attach(id, ext) {
  return { "content-disposition": `attachment; filename="ccglass-${id.replace(/\//g, "_")}.${ext}"` };
}

function toMarkdown(rec) {
  const fmt = detectFormat(rec);
  const A = getAdapter(fmt);
  const body = rec.request?.body || {};
  const view = A.view(body);
  const out = [];
  out.push(`# ${rec.request?.method} ${rec.request?.url}\n`);
  out.push(`- format: ${fmt}`);
  out.push(`- model: ${body.model}`);
  out.push(`- captured: ${new Date(rec.ts).toISOString()}\n`);
  out.push("## System\n");
  for (const b of view.system) out.push(`**${b.label}**\n\n` + "```text\n" + b.text + "\n```\n");
  out.push("## Messages\n");
  for (const m of view.messages) out.push(`**${m.label}**\n\n` + "```text\n" + m.text + "\n```\n");
  out.push(`## Tools (${view.tools.length})\n`);
  for (const t of view.tools) out.push(`- **${t.name}** — ${(t.description || "").split("\n")[0]}`);
  if (rec.response?.raw) {
    const r = A.reassemble(rec.response.raw);
    out.push("\n## Response\n");
    out.push(`- stop_reason: ${r?.stop_reason}`);
    out.push("```json\n" + JSON.stringify(r?.usage || {}, null, 2) + "\n```");
    for (const b of r?.content || []) out.push("```text\n" + (b.text ?? JSON.stringify(b)) + "\n```\n");
  }
  return out.join("\n");
}

function toHar(rec) {
  return {
    log: {
      version: "1.2",
      creator: { name: "ccglass", version: "0.1.0" },
      entries: [
        {
          startedDateTime: new Date(rec.ts).toISOString(),
          request: {
            method: rec.request?.method,
            url: rec.request?.url,
            headers: Object.entries(rec.request?.headers || {}).map(([name, value]) => ({ name, value: String(value) })),
            postData: { mimeType: "application/json", text: JSON.stringify(rec.request?.body) },
          },
          response: {
            status: rec.response?.status || 0,
            content: { mimeType: "text/event-stream", text: rec.response?.raw || "" },
          },
        },
      ],
    },
  };
}
