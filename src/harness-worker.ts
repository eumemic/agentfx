// harness-worker.ts — the killable worker process.
//   npm run harness:worker -- --model stub      (deterministic, for the crash proof)
//   npm run harness:worker -- --model claude     (real Claude + Python pymath::add tool)

import Anthropic from "@anthropic-ai/sdk";
import { getW, initWorker } from "./harness/iii";
import type { ToolSpec } from "./harness/model";
import { claudeModel } from "./harness/model-claude";
import { stubModel } from "./harness/model-stub";
import { startHarnessWorker } from "./harness/worker";
import { sleep, trigger } from "./util";

const arg = (flag: string, dflt: string): string => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const which = arg("--model", "stub");

initWorker(process.env.III_WORKER_NAME ?? "agentfx-harness-worker");

const ADD_TOOL: ToolSpec = {
  name: "add",
  description: "Add two integers and return their sum. Use this for ALL addition — never add numbers yourself.",
  input_schema: {
    type: "object",
    properties: { a: { type: "integer" }, b: { type: "integer" } },
    required: ["a", "b"],
    additionalProperties: false,
  },
};
const system = "You are a calculator agent. Use the `add` tool for every addition; never compute sums yourself.";

if (which === "claude") {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL });
  startHarnessWorker({
    model: claudeModel(client),
    tools: [ADD_TOOL],
    system,
    toolImpls: { add: async (i: any) => String((await trigger(getW(), "pymath::add", { a: i.a, b: i.b })).sum) },
  });
} else {
  startHarnessWorker({
    model: stubModel(),
    tools: [ADD_TOOL],
    system,
    // the sleep widens the crash window so the kill-9 proof lands mid-tool reliably
    toolImpls: {
      add: async (i: any) => {
        await sleep(1200);
        return String(Number(i.a) + Number(i.b));
      },
    },
  });
}

console.log(`[harness-worker] up (model=${which}, instance=${process.env.III_WORKER_INSTANCE ?? "?"})`);
setInterval(() => {}, 1 << 30); // keep the process alive
