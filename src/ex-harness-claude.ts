// ex-harness-claude.ts — the same durable harness, driven by a REAL Claude agent whose `add`
// tool is the Python pymath::add worker. The loop is the queue: each wake = one inference;
// tool completion appends a result event and re-wakes. Because it's the same machinery as the
// crash proof, this loop is durable too (kill the worker and it resumes).
//
// Requires: the iii engine, pymath_worker.py running, and ANTHROPIC_API_KEY (+ ANTHROPIC_BASE_URL).

import Anthropic from "@anthropic-ai/sdk";
import { readLog, resetSession, sendUserMessage } from "./harness/client";
import type { Event } from "./harness/events";
import { getW, initWorker } from "./harness/iii";
import type { ToolSpec } from "./harness/model";
import { claudeModel } from "./harness/model-claude";
import { startHarnessWorker } from "./harness/worker";
import { sleep, trigger } from "./util";

process.env.III_WORKER_INSTANCE = "claude";
initWorker("agentfx-harness-claude");

const SESSION = `claude-${crypto.randomUUID().slice(0, 8)}`;
const ADD_TOOL: ToolSpec = {
  name: "add",
  description: "Add two integers and return their sum. Use this for ALL addition.",
  input_schema: {
    type: "object",
    properties: { a: { type: "integer" }, b: { type: "integer" } },
    required: ["a", "b"],
    additionalProperties: false,
  },
};
const system = "You are a calculator agent. Use the `add` tool for every addition; never compute sums yourself.";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL });

// One process plays both worker (subscribes) and client (sends) — fine for a demo.
startHarnessWorker({
  model: claudeModel(client),
  tools: [ADD_TOOL],
  system,
  toolImpls: { add: async (i: any) => String((await trigger(getW(), "pymath::add", { a: i.a, b: i.b })).sum) },
  onEvent: (m) => console.log("  " + m),
});

(async () => {
  await resetSession(SESSION).catch(() => {});
  console.log(`\n=== real Claude agent on the durable harness — session ${SESSION} ===`);
  console.log("(the loop is the queue; the add tool is the Python pymath::add worker)\n");
  await sleep(1500);
  await sendUserMessage(SESSION, "What is 21 + 21, and then add 100 to that result? Use the add tool, one step at a time.");

  let fa: Extract<Event, { kind: "assistant" }> | undefined;
  const deadline = Date.now() + 120000;
  for (;;) {
    const a = [...(await readLog(SESSION))].reverse().find((e): e is Extract<Event, { kind: "assistant" }> => e.kind === "assistant");
    if (a && a.toolCalls.length === 0 && a.text.trim()) {
      fa = a;
      break;
    }
    if (Date.now() > deadline) break;
    await sleep(500);
  }

  const evs = await readLog(SESSION);
  console.log(`\n--- event log (${evs.length} events) ---`);
  for (const e of evs) {
    const tag = `#${String(e.seq).padStart(2)}`;
    if (e.kind === "user") console.log(`${tag} user: ${e.text.slice(0, 56)}…`);
    else if (e.kind === "assistant")
      console.log(
        `${tag} assistant react=${e.reacting_to} tools=[${e.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join(", ")}]${e.text ? ` "${e.text.slice(0, 44)}"` : ""}`,
      );
    else console.log(`${tag} tool_result ${e.name} → ${e.result}`);
  }
  console.log(`\nfinal answer: ${fa?.text ?? "(none — timed out)"}`);
  process.exit(fa ? 0 : 1);
})();
