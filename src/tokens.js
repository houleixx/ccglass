// Token estimation (approximate, for previews) + cost computation from the
// exact usage numbers Anthropic returns on every response.

// Rough token estimate: CJK chars count heavier than Latin text. Labelled "≈"
// everywhere in the UI — the real numbers come from response.usage.
export function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (text.match(/[㐀-鿿豈-﫿぀-ヿ]/g) || []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk * 1.5 + rest / 4);
}

export function estimateRequestTokens(body) {
  if (!body || typeof body !== "object") return 0;
  let chars = "";
  for (const blk of body.system || []) chars += blk.text || "";
  for (const m of body.messages || []) {
    const content = Array.isArray(m.content) ? m.content : [{ text: m.content }];
    for (const b of content) chars += b.text || JSON.stringify(b.input || "") || "";
  }
  for (const t of body.tools || []) chars += (t.description || "") + JSON.stringify(t.input_schema || "");
  return estimateTokens(chars);
}

// USD per 1M tokens. Approximate public Claude pricing; edit as needed.
const PRICES = {
  opus: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 0.8, output: 4, cacheWrite: 1.0, cacheRead: 0.08 },
};

function priceFor(model = "") {
  const m = model.toLowerCase();
  if (m.includes("opus")) return PRICES.opus;
  if (m.includes("haiku")) return PRICES.haiku;
  return PRICES.sonnet;
}

export function costFromUsage(model, usage = {}) {
  const p = priceFor(model);
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const usd =
    (input * p.input +
      output * p.output +
      cacheWrite * p.cacheWrite +
      cacheRead * p.cacheRead) /
    1e6;
  const totalInput = input + cacheWrite + cacheRead;
  const cacheHitRate = totalInput ? cacheRead / totalInput : 0;
  return {
    input,
    output,
    cacheWrite,
    cacheRead,
    totalInput,
    cacheHitRate,
    usd,
  };
}
