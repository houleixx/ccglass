import { test } from "node:test";
import assert from "node:assert/strict";
import { diffRequests, requestBlocks } from "../src/diff.js";

test("requestBlocks captures system/messages/tools with cache flags", () => {
  const blocks = requestBlocks({
    system: [{ type: "text", text: "S", cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    tools: [{ name: "Bash", description: "run" }],
  });
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].cache, true);
  assert.equal(blocks[2].kind, "tool");
});

test("diffRequests finds added blocks across a turn", () => {
  const a = { system: [{ text: "sys" }], messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] };
  const b = {
    system: [{ text: "sys" }],
    messages: [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
    ],
  };
  const d = diffRequests(a, b);
  assert.equal(d.counts.added, 1);
  assert.equal(d.counts.removed, 0);
  assert.match(d.added[0].text, /hi there/);
});
