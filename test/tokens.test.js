import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, costFromUsage } from "../src/tokens.js";

test("estimateTokens grows with length and counts CJK heavier", () => {
  assert.ok(estimateTokens("hello world") > 0);
  assert.ok(estimateTokens("你好世界") >= estimateTokens("hihi"));
});

test("costFromUsage computes cost and cache hit rate", () => {
  const c = costFromUsage("claude-opus-4-7", {
    input_tokens: 1000,
    output_tokens: 500,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 9000,
  });
  assert.equal(c.totalInput, 10000);
  assert.ok(Math.abs(c.cacheHitRate - 0.9) < 1e-9);
  assert.ok(c.usd > 0);
});
