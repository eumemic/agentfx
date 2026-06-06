// laws.ts — type LAWS checked by `tsc`. Each `@ts-expect-error` asserts the next line MUST
// NOT compile; if it wrongly compiled, tsc fails on the unused expectation. So a green
// `tsc --noEmit` is a PROOF the laws hold.

import { type Effect, flatMap, provide, retry, succeed, task } from "./effect";
import { runMemory } from "./interpret";
import { greet } from "./tasks";
import { remote } from "./remote";

const sig = new AbortController().signal;

// ── LAW 1: capability tracking — cannot run without supplying R ────────────
interface LLM {
  readonly llm: unknown;
}
interface DB {
  readonly db: unknown;
}
declare const prog: Effect<LLM & DB, string, number>;

runMemory(prog, { llm: 1, db: 2 }, sig); // ✓
// @ts-expect-error — missing capability `db`
runMemory(prog, { llm: 1 }, sig);
// @ts-expect-error — missing both
runMemory(prog, {}, sig);

// ── LAW 2: the Replayable brand — only tasks are retryable ─────────────────
const charge = task<{ amt: number }, string>("charge", (i) => `c:${i.amt}`, async () => "charged");

retry(charge.effect({ amt: 10 }), 3); // ✓ a task is Replayable
// @ts-expect-error — retry refuses a non-idempotent effect (the double-charge footgun)
retry(succeed(5), 3);
// @ts-expect-error — flatMap STRIPS the brand: the composed effect is no longer Replayable
retry(flatMap(charge.effect({ amt: 1 }), (x) => succeed(x)), 3);

// ── LAW 3: provide rejects capabilities that aren't required ───────────────
declare const need: Effect<LLM & DB, string, number>;
provide(need, { llm: 1 }); // ✓ discharges `llm`; the result still requires `db`
// @ts-expect-error — `bogus` is not a key of R
provide(need, { llm: 1, bogus: 9 });

// ── LAW 4: schemaTask infers In/Out from the zod schema — callers are typed ─
greet.effect({ name: "ada", times: 3 }); // ✓ matches the schema
// @ts-expect-error — `times` must be a number (inferred from z.number())
greet.effect({ name: "ada", times: "lots" });
// @ts-expect-error — missing required `name`
greet.effect({ times: 1 });

// ── LAW 5: remote() types come from a worker's DECLARED contract (any language) ─
// pymath::add is implemented in Python; these types were codegen'd from its contract.
remote("pymath::add")({ a: 1, b: 2 }); // ✓
// @ts-expect-error — `b` must be a number (derived from pymath::add's published schema)
remote("pymath::add")({ a: 1, b: "two" });
// @ts-expect-error — not a function id present on the engine's registry
remote("nope::missing")({});
