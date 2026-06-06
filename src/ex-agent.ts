// ex-agent.ts — a real LLM agent whose tool is a PYTHON worker, end to end on iii.
//
//   Claude (opus-4-8, in this process) → tool call `add` → remote("pymath::add") (typed)
//      → runDist → iii engine → the Python pymath worker → result back to the model.
//
// Requires the engine + pymath_worker.py running. Uses ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL.

import Anthropic from "@anthropic-ai/sdk";
import { ADD_TOOL, runAgent } from "./agent";
import { runDist } from "./interpret";
import { remote } from "./remote";
import { makeIIIBackend } from "./runtime-iii";
import { sleep } from "./util";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
});

console.log("connecting to engine...");
await sleep(1500);
const be = makeIIIBackend();

// The agent's `add` tool is the Python pymath::add worker, called via the typed remote() client.
const runTool = async (name: string, input: unknown): Promise<string> => {
  if (name !== "add") return `error: unknown tool ${name}`;
  const r = await runDist(remote("pymath::add")(input as { a: number; b: number }), {}, be);
  return r.ok ? String(r.value.sum) : `error: ${String((r.error as Error)?.message ?? r.error)}`;
};

const question = "What is 21 + 21, and then add 100 to that result? Use the add tool, one step at a time.";
console.log(`\n=== agent question: "${question}" ===`);
console.log("(the add tool is the Python pymath::add worker)\n");

const result = await runAgent(question, {
  client,
  tools: [ADD_TOOL],
  system: "You are a calculator agent. Use the `add` tool for every addition; never compute sums yourself.",
  runTool,
  onEvent: (e) => console.log("  " + e),
});

console.log(`\nfinal answer: ${result.text}   (${result.steps} tool round(s))`);
process.exit(0);
