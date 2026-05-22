// Anthropic Messages API adapter (Claude Code, and Anthropic-compatible
// providers like Kimi/Moonshot). Delegates to the existing parse/diff/tokens.

import { reassembleResponse, blockText } from "../parse.js";
import { requestBlocks } from "../diff.js";
import { estimateRequestTokens, costFromUsage } from "../tokens.js";

export const anthropic = {
  name: "anthropic",

  summary(body = {}) {
    return {
      model: body.model,
      nMessages: Array.isArray(body.messages) ? body.messages.length : 0,
      nTools: Array.isArray(body.tools) ? body.tools.length : 0,
    };
  },

  // Normalized view the dashboard renders (format-independent shape).
  view(body = {}) {
    const system = (body.system || []).map((b, i) => ({
      label: `system[${i}]`,
      text: b.text || "",
      cache: !!b.cache_control,
    }));
    const messages = [];
    (body.messages || []).forEach((m, mi) => {
      const content = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
      content.forEach((b, bi) => {
        messages.push({
          label: `msg[${mi}].${m.role}[${bi}]`,
          role: m.role,
          type: b.type || "text",
          text: b.text ?? (b.input ? JSON.stringify(b.input, null, 2) : blockText(b)),
          cache: !!b.cache_control,
        });
      });
    });
    const tools = (body.tools || []).map((t) => ({
      name: t.name,
      description: t.description || "",
      schema: t.input_schema || {},
    }));
    return { system, messages, tools };
  },

  blocks: requestBlocks,
  reassemble: reassembleResponse,
  estimateTokens: estimateRequestTokens,
  cost: costFromUsage,
};
