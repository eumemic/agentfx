// ex-differential.ts — THE headline proof. One typed program; two interpreters;
// identical results. runMemory runs it in-process; runDist runs it on iii (durable
// queue + atomic state). Requires ex-executor.ts running.

import { flatMap, forEachPar, map } from "./effect";
import { runDist, runMemory } from "./interpret";
import { makeIIIBackend } from "./runtime-iii";
import { lengthOf, upper } from "./tasks";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const items = ["alpha", "bravo", "charlie", "delta", "echo"];

// ONE description, built from typed combinators:
//   fan-out uppercase (conc 3) -> fan-out length of each (conc 2) -> fold to a summary
const program = flatMap(
  forEachPar(items, (s) => upper.effect(s), 3),
  (uppers) =>
    map(
      forEachPar(uppers, (s) => lengthOf.effect(s), 2),
      (lens) => ({ uppers, totalLen: lens.reduce((a, b) => a + b, 0) }),
    ),
);

console.log("connecting to engine...");
await sleep(1500);
const sig = new AbortController().signal;

console.log("running the SAME program under both interpreters...\n");
const tM = Date.now();
const m = await runMemory(program, {}, sig);
const memMs = Date.now() - tM;

const be = makeIIIBackend();
const tD = Date.now();
const d = await runDist(program, {}, be, sig);
const distMs = Date.now() - tD;

console.log("runMemory:", JSON.stringify(m));
console.log("runDist  :", JSON.stringify(d));

const identical = m.ok && d.ok && JSON.stringify(m) === JSON.stringify(d);
console.log(
  `\nequivalence: ${identical ? "IDENTICAL ✅  — one program, two backends, same result" : "MISMATCH ❌"}`,
);
console.log(`timing: runMemory ${memMs}ms · runDist ${distMs}ms (iii pays the durable-queue + WS tax)`);
process.exit(identical ? 0 : 1);
