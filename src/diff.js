// Turn-to-turn diff over an ordered list of content blocks. Block extraction is
// format-specific (see src/formats/*); the diff itself is format-agnostic.

import { createHash } from "node:crypto";
import { blockText } from "./parse.js";

const key = (b) => createHash("sha1").update(`${b.kind} ${b.text}`).digest("hex").slice(0, 12);

// Anthropic block extraction (also used by the anthropic adapter + tests).
export function requestBlocks(body = {}) {
  const out = [];
  (body.system || []).forEach((b, i) => {
    out.push({ kind: "system", label: `system[${i}]`, text: b.text || "", cache: !!b.cache_control });
  });
  (body.messages || []).forEach((m, mi) => {
    const content = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
    content.forEach((b, bi) => {
      out.push({
        kind: "message",
        label: `msg[${mi}].${m.role}[${bi}]`,
        type: b.type,
        text: blockText(b),
        cache: !!b.cache_control,
      });
    });
  });
  (body.tools || []).forEach((t) => {
    out.push({ kind: "tool", label: `tool:${t.name}`, text: t.description || "", cache: false });
  });
  return out;
}

export function diffBlockLists(a, b) {
  const aKeys = new Set(a.map(key));
  const bKeys = new Set(b.map(key));
  const added = b.filter((x) => !aKeys.has(key(x)));
  const removed = a.filter((x) => !bKeys.has(key(x)));
  const common = b.filter((x) => aKeys.has(key(x)));
  return {
    added,
    removed,
    common,
    counts: {
      added: added.length,
      removed: removed.length,
      common: common.length,
      cachedInB: b.filter((x) => x.cache).length,
    },
  };
}

// Convenience for the anthropic case + existing tests.
export function diffRequests(bodyA, bodyB) {
  return diffBlockLists(requestBlocks(bodyA), requestBlocks(bodyB));
}
