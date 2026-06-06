// ex-catch.ts — a contract violation as a RECOVERABLE typed branch.
//
// parseAmount declares output `z.number().finite()`. Number("oops") is NaN, which violates
// that output contract → the boundary rejects it as a typed failure. `catchAll` turns that
// failure into a branch (here: fall back to -1) — identically under both interpreters.
// Requires ex-executor.ts running.

import { type Result, catchAll, succeed } from "./effect";
import { runDist, runMemory } from "./interpret";
import { makeIIIBackend } from "./runtime-iii";
import { parseAmount } from "./tasks";
import { sleep } from "./util";

const sig = new AbortController().signal;
const show = (r: Result<unknown, unknown>): string =>
  r.ok
    ? `ok(${JSON.stringify(r.value)})`
    : `fail(${(r.error as Error)?.name ?? "?"}: ${String((r.error as Error)?.message ?? r.error)
        .replace(/\s+/g, " ")
        .slice(0, 48)}…)`;

console.log("connecting to engine...");
await sleep(1500);
const be = makeIIIBackend();

console.log("\nparseAmount: string -> z.number().finite()  (NaN breaks the output contract)\n");

for (const input of ["42", "oops"]) {
  // [a] raw — the contract violation surfaces as a typed failure under both interpreters
  const raw = parseAmount.effect(input);
  const [rm, rd] = await Promise.all([runMemory(raw, {}, sig), runDist(raw, {}, be, sig)]);
  console.log(`  raw   parseAmount(${JSON.stringify(input)}):  memory=${show(rm)}  dist=${show(rd)}`);

  // [b] recovered — catchAll turns the failure into a typed branch (fallback -1)
  const safe = catchAll(parseAmount.effect(input), () => succeed(-1));
  const [sm, sd] = await Promise.all([runMemory(safe, {}, sig), runDist(safe, {}, be, sig)]);
  console.log(`  safe  catchAll(..., -1)   :  memory=${show(sm)}  dist=${show(sd)}\n`);
}

console.log(
  "note: the recovered value is identical across interpreters; the raw error SHAPE differs by\n" +
    "design (runMemory keeps the structured ZodError; over the wire it arrives as a message).",
);
process.exit(0);
