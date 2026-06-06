// ex-preempt-agent.ts — preemption on a REAL agent turn. The open question: does the epoch
// fence compose with a real, multi-step LLM turn + real tool calls?
//
// A new user message arrives mid-turn. We (a) abort the in-flight inference (soft, saves
// tokens) AND (b) gate every tool call on the epoch fence (hard): a stale turn's tool is
// refused because the fence sees a newer generation. Only the latest message's tool fires.
//
// Requires the engine + pymath_worker.py. Uses ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL.

import Anthropic from "@anthropic-ai/sdk";
import { ADD_TOOL, Superseded, runAgent } from "./agent";
import { bumpGen, fence, fireTool, readState, resetAgent } from "./iii";
import { runDist } from "./interpret";
import { remote } from "./remote";
import { makeIIIBackend } from "./runtime-iii";
import { sleep } from "./util";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
});
const AGENT = "agent-chat";

console.log("connecting to engine...");
await sleep(1500);
const be = makeIIIBackend();
await resetAgent(AGENT);

const inflight: { ac: AbortController | null } = { ac: null };

async function turn(gen: number, userText: string): Promise<void> {
  const ac = new AbortController();
  inflight.ac = ac;

  // The tool runner is FENCED: only fire if this turn's gen is still the latest.
  const runTool = async (name: string, input: unknown, step: number): Promise<string> => {
    const current = await fence(AGENT, gen, step); // atomic: old.gen == gen && unclaimed
    if (!current) throw new Superseded();
    const r = await runDist(remote("pymath::add")(input as { a: number; b: number }), {}, be);
    await fireTool(AGENT, gen); // observable: this gen actually fired a tool
    return r.ok ? String(r.value.sum) : `error: ${String((r.error as Error)?.message ?? r.error)}`;
  };

  const res = await runAgent(userText, {
    client,
    tools: [ADD_TOOL],
    system: "You are a calculator agent. Use the `add` tool for every addition; never compute sums yourself.",
    runTool,
    signal: ac.signal,
    onEvent: (e) => console.log(`   [gen${gen}] ${e}`),
  });
  console.log(`   [gen${gen}] => ${res.superseded ? "SUPERSEDED — no stale tool fired" : `answered: ${res.text}`}`);
}

// message 1
const g1 = await bumpGen(AGENT);
console.log(`\nUSER (gen${g1}): "add 10 and 10"`);
const t1 = turn(g1, "Add 10 and 10 using the add tool.");

// message 2 arrives mid-turn → preempt
await sleep(1500);
inflight.ac?.abort(); // soft-cancel the in-flight inference
const g2 = await bumpGen(AGENT);
console.log(`USER (gen${g2}): "actually, add 5 and 5"   (preempts gen${g1})`);
const t2 = turn(g2, "Actually, add 5 and 5 using the add tool.");

await Promise.allSettled([t1, t2]);

const st = await readState(AGENT);
const firedGens = Object.keys(st.fired ?? {});
console.log(`\nfired tools by generation: [${firedGens.join(", ")}]`);
console.log(
  firedGens.length === 1 && firedGens[0] === String(g2)
    ? "PASS ✅ — only the latest message's tool fired; the preempted turn was fenced out"
    : "FAIL ❌ — a stale turn fired (or none did)",
);
process.exit(0);
