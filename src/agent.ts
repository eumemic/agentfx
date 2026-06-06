// agent.ts — a real ReAct agent loop on agentfx.
//
// The reasoning loop runs in the driver (an agent's reasoning is local); its TOOLS are iii
// workers — possibly in other languages — invoked through `runTool`. The loop is interpreter-
// agnostic and abortable, and a tool runner may throw `Superseded` to abort a stale turn
// before any side effect fires (used by the preemption demo).

import Anthropic from "@anthropic-ai/sdk";

/** Thrown by a tool runner when the turn has been superseded — abort before the tool fires. */
export class Superseded extends Error {
  constructor() {
    super("turn superseded");
    this.name = "Superseded";
  }
}

export interface AgentResult {
  text: string;
  steps: number;
  superseded: boolean;
}

export interface AgentDeps {
  client: Anthropic;
  tools: Anthropic.Tool[];
  /** Execute one tool call → tool_result content. Throw `Superseded` to abort the turn. */
  runTool: (name: string, input: unknown, step: number) => Promise<string>;
  model?: string;
  system?: string;
  signal?: AbortSignal;
  onEvent?: (e: string) => void;
  maxSteps?: number;
}

export async function runAgent(userText: string, deps: AgentDeps): Promise<AgentResult> {
  const model = deps.model ?? "claude-opus-4-8";
  const log = deps.onEvent ?? (() => {});
  const maxSteps = deps.maxSteps ?? 8;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userText }];

  for (let step = 0; step < maxSteps; step++) {
    let resp: Anthropic.Message;
    try {
      resp = await deps.client.messages.create(
        {
          model,
          max_tokens: 16000,
          thinking: { type: "adaptive" },
          system: deps.system,
          tools: deps.tools,
          messages,
        },
        { signal: deps.signal },
      );
    } catch (err) {
      if (deps.signal?.aborted) {
        log("inference aborted (preempted) — no tool fired");
        return { text: "", steps: step, superseded: true };
      }
      throw err;
    }

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text.trim()) log(`assistant: ${text.trim()}`);

    if (resp.stop_reason !== "tool_use") {
      return { text: text.trim(), steps: step, superseded: false };
    }

    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: resp.content }); // preserve thinking + tool_use blocks

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      log(`tool_use:  ${tu.name}(${JSON.stringify(tu.input)})`);
      let content: string;
      try {
        content = await deps.runTool(tu.name, tu.input, step);
      } catch (err) {
        if (err instanceof Superseded) {
          log("✋ tool refused by the fence (turn superseded) — no stale side effect");
          return { text: "", steps: step, superseded: true };
        }
        content = `error: ${String((err as Error)?.message ?? err)}`;
      }
      log(`tool_out:  ${content}`);
      results.push({ type: "tool_result", tool_use_id: tu.id, content });
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "(max steps reached)", steps: maxSteps, superseded: false };
}

/** The agent's `add` tool, declared for the model. Backed by the Python pymath::add worker. */
export const ADD_TOOL: Anthropic.Tool = {
  name: "add",
  description: "Add two integers and return their sum. Use this for ALL addition — do not add numbers yourself.",
  input_schema: {
    type: "object",
    properties: { a: { type: "integer" }, b: { type: "integer" } },
    required: ["a", "b"],
    additionalProperties: false,
  },
};
