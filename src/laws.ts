// laws.ts — type LAWS checked by `tsc`. Each `@ts-expect-error` asserts the next line
// MUST NOT compile; if it wrongly compiled, tsc fails on the unused expectation. So
// `tsc --noEmit` passing is a PROOF the laws hold.

import { type Effect, retry, succeed, task } from "./effect";
import { runMemory } from "./interpret";

const sig = new AbortController().signal;

// ── LAW 1: capability tracking ────────────────────────────────────────────
interface LLM {
  readonly llm: unknown;
}
interface DB {
  readonly db: unknown;
}
declare const prog: Effect<LLM & DB, string, number>;

runMemory(prog, { llm: 1, db: 2 }, sig); // ✓ both capabilities supplied

// @ts-expect-error — missing capability `db` ⇒ cannot run
runMemory(prog, { llm: 1 }, sig);

// @ts-expect-error — missing both capabilities ⇒ cannot run
runMemory(prog, {}, sig);

// ── LAW 2: the Replayable brand ───────────────────────────────────────────
const charge = task<{ amt: number }, string>("charge", (i) => `c:${i.amt}`, async () => "charged");

retry(charge.effect({ amt: 10 }), 3); // ✓ a task is Replayable

// @ts-expect-error — retry refuses a non-idempotent effect (the double-charge footgun, as a type error)
retry(succeed(5), 3);
