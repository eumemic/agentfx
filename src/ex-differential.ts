// ex-differential.ts — one typed program, two interpreters. Test 1: the happy path is
// byte-identical. Test 2: a failing task surfaces a failure under BOTH (neither hangs nor
// throws) — the error *shapes* differ honestly (runMemory = raw cause; runDist = aggregated).
// Requires ex-executor.ts running.

import { flatMap, forEachTask, map } from "./effect";
import { runDist, runMemory } from "./interpret";
import { makeIIIBackend } from "./runtime-iii";
import { flaky, lengthOf, upper } from "./tasks";
import { sleep } from "./util";

const sig = new AbortController().signal;

// happy path: fan-out uppercase (conc 3) -> fan-out length (conc 2) -> fold to a summary
const happy = flatMap(
  forEachTask(["alpha", "bravo", "charlie", "delta", "echo"], upper, 3),
  (uppers) =>
    map(forEachTask(uppers, lengthOf, 2), (lens) => ({ uppers, totalLen: lens.reduce((a, b) => a + b, 0) })),
);

// failure path: one task throws
const failing = forEachTask(["fine", "boom", "ok"], flaky, 2);

console.log("connecting to engine...");
await sleep(1500);
const be = makeIIIBackend();

console.log("\n[1] happy path — same program under both interpreters:");
const [m1, d1] = await Promise.all([runMemory(happy, {}, sig), runDist(happy, {}, be, sig)]);
console.log("    runMemory:", JSON.stringify(m1));
console.log("    runDist  :", JSON.stringify(d1));
const identical = m1.ok && d1.ok && JSON.stringify(m1) === JSON.stringify(d1);
console.log(`    => ${identical ? "IDENTICAL ✅" : "MISMATCH ❌"}`);

console.log("\n[2] failure path — a throwing task is surfaced (not hung, not unhandled):");
const [m2, d2] = await Promise.all([runMemory(failing, {}, sig), runDist(failing, {}, be, sig)]);
console.log("    runMemory:", m2.ok ? "ok" : `fail(${String((m2.error as Error)?.message ?? m2.error)})`);
console.log("    runDist  :", d2.ok ? "ok" : `fail(${String((d2.error as Error)?.message ?? d2.error)})`);
const bothFailed = !m2.ok && !d2.ok;
console.log(`    => both surfaced a typed failure: ${bothFailed ? "YES ✅ (shapes differ by design)" : "NO ❌"}`);

const pass = identical && bothFailed;
console.log(`\noverall: ${pass ? "PASS ✅" : "FAIL ❌"}`);
process.exit(pass ? 0 : 1);
