# agentfx

**A tiny typed effect system whose production interpreter is a durable distributed runtime.**

You write one typed program from a small algebra of combinators. A *reference* interpreter
runs it in-process (great for tests). A *distributing* interpreter runs the same program on
[iii](https://iii.dev) — an at-least-once durable queue with atomic state — so it survives
process death. The two are proven to agree by a differential test.

The thesis in one line: **a typed effect algebra on top, a durable runtime underneath, and the
boundary between "elegant" and "durable" is the interpreter.** A `mergeMap` that survives a
`kill -9`, which a pure in-memory `Observable` never could.

> Status: a working spike (the "LLM" in examples is a timer; the point is control flow + the
> lowering, not inference). See **Limits** below for exactly what is and isn't real.

---

## The two type laws (enforced by the compiler)

These aren't documentation — they're checked by `tsc`. `laws.ts` proves them with
`@ts-expect-error`: if a guard stopped firing, the build would fail.

**1. You cannot `retry` a non-idempotent effect.** The cold-resubscribe / double-charge footgun
is a *compile error*, not a runtime surprise:

```ts
retry(charge.effect({ amt: 10 }), 3); // ✓ a task() is Replayable
retry(succeed(5), 3);                 // ✗ compile error: not Replayable
```

**2. You cannot run an effect without supplying its capabilities.** Requirements accumulate in
the type `R`; `runMemory(prog, env)` won't typecheck unless `env` satisfies `R`.

```ts
runMemory(prog, { llm, db }); // ✓
runMemory(prog, { llm });     // ✗ compile error: missing `db`
```

## One program, two interpreters

```ts
// build a description from typed combinators
const program = flatMap(
  forEachPar(items, (s) => upper.effect(s), 3),     // fan-out, bounded concurrency
  (uppers) => map(forEachPar(uppers, (s) => lengthOf.effect(s), 2),
                  (lens) => ({ uppers, totalLen: lens.reduce((a, b) => a + b, 0) })),
);

await runMemory(program, {});            // in-process: a promise pool. instant, for tests.
await runDist(program, {}, iiiBackend);  // on iii: a durable queue. crash-surviving.
```

`ex-differential.ts` runs *both* on the same program and asserts the results are byte-identical.
`ex-durability.ts` kills the executor mid-batch and shows `runDist` still completes every task.

## How combinators lower to iii

| combinator | `runMemory` | `runDist` (iii) |
|---|---|---|
| `forEachPar(_, n)` | promise pool, concurrency `n` | durable queue, `concurrency:n`, at-least-once, DLQ |
| `task(...).effect()` | call the local impl | `iii::durable::publish` → registered fn, idempotent by key |
| `retry` (needs `Replayable`) | loop | loop riding the queue's at-least-once |
| `flatMap` / `map` / `provide` | in-process | in-process (driver) |
| `switchMap` (preemption, see `demo.ts`) | unsubscribe | the atomic **epoch fence** — only the latest input's tool fires |

## Run it

```bash
npm install
# 1. start the iii engine in your iii project:  iii --config config.yaml
#    (this repo's examples expect iii-state + iii-queue workers running)
npm run executor      # terminal A: registers the tasks + the batch subscriber
npm run differential  # terminal B: proves runMemory ≡ runDist
npm run durability     # terminal B: kill the executor mid-run, watch it finish anyway
npm run preempt        # the switchMap → epoch-fence preemption demo
npm run typecheck     # the type laws are the test
```

## Design notes

- **Reified, not final.** `Effect<R,E,A>` is a *data* tree (tagged union), so interpreters can
  walk it. TS has no GADTs, so the tree erases intermediate types in `FlatMap`/`Par`; that
  erasure is contained to the constructors in `effect.ts` (each marked). This is exactly why
  Effect-TS went fiber/tagless-final instead — the trade-off is real and named here.
- **Closures don't distribute.** `runDist` can only fan out `task()` effects (a registered
  `fnId` + serializable args), never arbitrary closures — the same reason RPC can't ship a
  lambda. The interpreter throws a clear error if you try.
- **Backend is pluggable.** `runDist` targets a `Backend` interface; `runtime-iii.ts` is one
  implementation. The algebra doesn't know about iii.

## Limits (honest)

- The example "LLM" is a `setTimeout`; tasks are `toUpperCase`/`length`. The point is the
  control plane + the lowering, not inference. Wire a real model into a `task` and it works.
- Durability is proven across **consumer** crashes (the engine holds the messages). The default
  iii `builtin` broker is in-memory, so it is **not** durable across an **engine** restart —
  that needs a persistent queue adapter.
- `runDist`'s per-`Par` concurrency maps to the executor subscription's concurrency (a
  deployment setting), whereas `runMemory` honors it exactly per call.
- A general structural interpreter covers the `Effect` tree; `switchMap` preemption is a
  separate stream-level lowering (`demo.ts` + `iii.ts`).

## License

MIT.
