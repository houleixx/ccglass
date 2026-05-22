import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, listSessions, loadSession } from "../src/store.js";

test("Store masks auth, persists, and reloads from disk", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccglass-"));
  const store = new Store({ root });

  const rec = store.add({
    request: {
      method: "POST",
      url: "/v1/messages",
      headers: { authorization: "Bearer sk-ant-oat01-SECRETSECRETSECRET-TAIL" },
      body: { model: "claude-opus-4-7", messages: [], tools: [] },
    },
  });
  rec.response = { status: 200, raw: 'data: {"type":"message_stop"}' };
  store.update(rec);

  // masked in memory + on disk
  assert.match(rec.request.headers.authorization, /REDACTED/);

  const sessions = listSessions(root);
  assert.equal(sessions.length, 1);
  const loaded = loadSession(root, sessions[0]);
  assert.equal(loaded.length, 1);
  assert.match(loaded[0].request.headers.authorization, /REDACTED/);
  assert.equal(loaded[0].response.status, 200);

  fs.rmSync(root, { recursive: true, force: true });
});
