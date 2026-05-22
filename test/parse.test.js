import { test } from "node:test";
import assert from "node:assert/strict";
import { reassembleResponse, blockText } from "../src/parse.js";

test("reassembleResponse reconstructs streamed text + usage + stop_reason", () => {
  const sse = [
    `event: message_start`,
    `data: {"type":"message_start","message":{"model":"claude-opus-4-7","usage":{"input_tokens":10,"cache_read_input_tokens":5}}}`,
    `event: content_block_start`,
    `data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`,
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}`,
    `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}`,
    `data: [DONE]`,
  ].join("\n");

  const r = reassembleResponse(sse);
  assert.equal(r.streamed, true);
  assert.equal(r.model, "claude-opus-4-7");
  assert.equal(r.stop_reason, "end_turn");
  assert.equal(r.usage.input_tokens, 10);
  assert.equal(r.usage.output_tokens, 7);
  assert.equal(r.content[0].text, "Hello world");
});

test("reassembleResponse assembles streamed tool_use input json", () => {
  const sse = [
    `data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"Bash","input":{}}}`,
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":"}}`,
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"ls\\"}"}}`,
  ].join("\n");
  const r = reassembleResponse(sse);
  assert.equal(r.content[0].type, "tool_use");
  assert.deepEqual(r.content[0].input, { command: "ls" });
});

test("reassembleResponse parses non-streaming JSON", () => {
  const json = JSON.stringify({ model: "x", stop_reason: "end_turn", usage: { input_tokens: 3 }, content: [{ type: "text", text: "hi" }] });
  const r = reassembleResponse(json);
  assert.equal(r.streamed, false);
  assert.equal(r.content[0].text, "hi");
});

test("blockText flattens block types", () => {
  assert.equal(blockText({ type: "text", text: "a" }), "a");
  assert.match(blockText({ type: "tool_use", name: "Bash", input: { x: 1 } }), /tool_use Bash/);
});
