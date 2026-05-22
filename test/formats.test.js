import { test } from "node:test";
import assert from "node:assert/strict";
import { openai } from "../src/formats/openai.js";
import { anthropic } from "../src/formats/anthropic.js";
import { detectFormat, getAdapter } from "../src/formats/index.js";

test("detectFormat: by recorded format, url, and body shape", () => {
  assert.equal(detectFormat({ format: "openai" }), "openai");
  assert.equal(detectFormat({ request: { url: "/v1/responses" } }), "openai");
  assert.equal(detectFormat({ request: { url: "/v1/chat/completions" } }), "openai");
  assert.equal(detectFormat({ request: { body: { instructions: "x", input: [] } } }), "openai");
  assert.equal(detectFormat({ request: { url: "/v1/messages", body: { system: [] } } }), "anthropic");
});

test("openai.view extracts instructions/input/tools (Responses API)", () => {
  const body = {
    model: "gpt-5-codex",
    instructions: "You are Codex.",
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "list files" }] },
    ],
    tools: [{ type: "function", name: "shell", description: "run shell", parameters: { type: "object" } }],
  };
  const v = openai.view(body);
  assert.equal(v.system[0].text, "You are Codex.");
  assert.match(v.messages[0].text, /list files/);
  assert.equal(v.tools[0].name, "shell");
});

test("openai.reassemble rebuilds Responses API stream + usage", () => {
  const sse = [
    `data: {"type":"response.created","response":{"model":"gpt-5-codex"}}`,
    `data: {"type":"response.output_text.delta","delta":"Hello "}`,
    `data: {"type":"response.output_text.delta","delta":"world"}`,
    `data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":80}}}}`,
  ].join("\n");
  const r = openai.reassemble(sse);
  assert.equal(r.content[0].text, "Hello world");
  assert.equal(r.usage.input_tokens, 100);
  assert.equal(r.usage.cache_read_input_tokens, 80);
  assert.equal(r.stop_reason, "completed");
});

test("openai.reassemble rebuilds Chat Completions stream", () => {
  const sse = [
    `data: {"model":"gpt-4o","choices":[{"delta":{"content":"hi"}}]}`,
    `data: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3}}`,
    `data: [DONE]`,
  ].join("\n");
  const r = openai.reassemble(sse);
  assert.equal(r.content[0].text, "hi there");
  assert.equal(r.usage.input_tokens, 10);
  assert.equal(r.usage.output_tokens, 3);
});

test("openai.cost subtracts cached tokens from billed input", () => {
  const c = openai.cost("gpt-5-codex", { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 800 });
  assert.equal(c.cacheRead, 800);
  assert.equal(c.totalInput, 1000);
  assert.ok(Math.abs(c.cacheHitRate - 0.8) < 1e-9);
  assert.ok(c.usd > 0);
});

test("getAdapter falls back to anthropic", () => {
  assert.equal(getAdapter("nope"), anthropic);
});
