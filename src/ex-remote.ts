// ex-remote.ts — call a PYTHON worker from TypeScript with types derived from its contract.
// Run `npm run gen` first (with pymath_worker.py + ex-executor.ts running) to produce
// src/contracts.generated.ts, then this.

import { runDist } from "./interpret";
import { makeIIIBackend } from "./runtime-iii";
import { remote } from "./remote";
import { sleep } from "./util";

console.log("connecting to engine...");
await sleep(1500);
const be = makeIIIBackend();
const sig = new AbortController().signal;

// pymath::add is implemented in PYTHON; its TS types were derived from its declared contract.
console.log("\ncalling pymath::add (a Python worker) from TypeScript:");
const r = await runDist(remote("pymath::add")({ a: 2, b: 3 }), {}, be, sig);
console.log("  remote('pymath::add')({ a: 2, b: 3 }) ->", JSON.stringify(r));
if (r.ok) console.log("  typed result: sum =", r.value.sum, "(r.value is typed { sum: number })");

process.exit(r.ok ? 0 : 1);
