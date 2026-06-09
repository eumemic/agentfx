// model-claude.ts — the real adapter: reconstruct the Anthropic message list from the event
// log and make ONE inference call per step (adaptive thinking). The assistant event stores the
// raw content blocks (`raw`), so thinking-block continuation round-trips across wakes/crashes —
// the same reason aios keeps its event `data` opaque.

import Anthropic from "@anthropic-ai/sdk";
import type { Event, ToolCall } from "./events";
import type { Model, ModelTurn, ToolSpec } from "./model";

export function claudeModel(client: Anthropic, model = "claude-opus-4-8"): Model {
  return {
    async step({ events, tools, system }): Promise<ModelTurn> {
      const resp = await client.messages.create({
        model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema })),
        messages: toMessages(events),
      });
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const toolCalls: ToolCall[] = resp.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((tu) => ({ id: tu.id, name: tu.name, input: tu.input }));
      return { text, toolCalls, raw: resp.content };
    },
  };
}

/** Event log → Anthropic messages. Adjacent tool_results coalesce into one user turn. */
function toMessages(events: Event[]): Anthropic.MessageParam[] {
  const msgs: Anthropic.MessageParam[] = [];
  let pending: Anthropic.ToolResultBlockParam[] = [];
  const flush = (): void => {
    if (pending.length) {
      msgs.push({ role: "user", content: pending });
      pending = [];
    }
  };
  for (const e of events) {
    if (e.kind === "user") {
      flush();
      msgs.push({ role: "user", content: e.text });
    } else if (e.kind === "assistant") {
      flush();
      const content = (e.raw as Anthropic.ContentBlockParam[] | undefined) ?? [{ type: "text", text: e.text || "(thinking)" }];
      msgs.push({ role: "assistant", content });
    } else {
      pending.push({ type: "tool_result", tool_use_id: e.toolCallId, content: e.result, is_error: e.isError });
    }
  }
  flush();
  return msgs;
}
