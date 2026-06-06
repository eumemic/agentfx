// ex-schema.ts — the typed wire boundary. One zod schema gives `greet` its static In/Out,
// publishes a JSON Schema to the engine, and validates incoming args at the executor.
// Requires ex-executor.ts running. After this, `iii trigger agentfx::greet --help` shows
// the published request schema (no longer "no request schema published").

import { runDist } from "./interpret";
import { makeIIIBackend } from "./runtime-iii";
import { greet } from "./tasks";
import { sleep } from "./util";

console.log("connecting to engine...");
await sleep(1500);
const be = makeIIIBackend();
const sig = new AbortController().signal;

// [1] typed happy path — { name, times } is inferred from the zod schema; wrong shapes
//     wouldn't compile (see src/laws.ts).
console.log("\n[1] typed call: greet({ name: 'ada', times: 3 })");
const r = await runDist(greet.effect({ name: "ada", times: 3 }), {}, be, sig);
console.log("   ->", JSON.stringify(r));

// [2] runtime validation at the boundary: a bad payload sent PAST the type system
//     (times out of range, empty name) is rejected by the executor's schema parse.
console.log("\n[2] bad payload (name:'', times:99) pushed past the types via callRemote:");
try {
  const bad = await be.callRemote("agentfx::greet", { name: "", times: 99 });
  console.log("   -> unexpectedly accepted:", JSON.stringify(bad));
} catch (err) {
  const msg = String((err as Error)?.message ?? err).replace(/\s+/g, " ").slice(0, 140);
  console.log("   -> rejected at the boundary:", msg);
}

process.exit(0);
