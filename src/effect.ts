// effect.ts — a REIFIED typed effect tree (data, not thunks), so multiple interpreters
// can walk the same program: `runMemory` (in-process) and `runDist` (a durable runtime).
//
// Type laws enforced by the compiler (see test/laws.ts):
//   • capability tracking — cannot run without supplying R
//   • the Replayable brand — cannot `retry` a non-idempotent effect
//
// TS has no GADTs, so a reified tree erases intermediate types (FlatMap, Par, CatchAll).
// That erasure is contained to the constructors below; the public API stays typed.

export type Result<E, A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E };

export const ok = <A>(value: A): Result<never, A> => ({ ok: true, value });
export const fail = <E>(error: E): Result<E, never> => ({ ok: false, error });

/** Returned when an effect is aborted via its AbortSignal. */
export class Interrupted extends Error {
  constructor() {
    super("effect interrupted");
    this.name = "Interrupted";
  }
}

declare const ReplayableTag: unique symbol;
/** Phantom evidence that an effect is safe to re-run. Only `task(...)` mints it. */
export interface Replayable {
  readonly [ReplayableTag]: true;
}

/** Context handed to a task impl. `idempotencyKey` is derived from the task's args and is
 *  stable across retries/redeliveries — pass it to external providers for exactly-once. */
export interface TaskCtx {
  readonly idempotencyKey: string;
}

export type Effect<R, E, A> =
  | { readonly _tag: "Succeed"; readonly value: A }
  | { readonly _tag: "Fail"; readonly error: E }
  | {
      readonly _tag: "Suspend";
      readonly thunk: (env: R, signal: AbortSignal) => Promise<Result<E, A>>;
      readonly label?: string;
    }
  | {
      readonly _tag: "Remote";
      readonly fnId: string;
      readonly args: unknown;
      readonly key: string;
      readonly local: (args: unknown, ctx: TaskCtx) => Promise<unknown>;
    }
  | { readonly _tag: "FlatMap"; readonly first: Effect<R, E, unknown>; readonly f: (x: unknown) => Effect<R, E, A> }
  | { readonly _tag: "Par"; readonly effects: ReadonlyArray<Effect<R, E, unknown>>; readonly concurrency: number }
  | { readonly _tag: "Retry"; readonly effect: Effect<R, E, A>; readonly times: number }
  | { readonly _tag: "Provide"; readonly layer: Record<string, unknown>; readonly effect: Effect<unknown, E, A> }
  | {
      readonly _tag: "CatchAll";
      readonly effect: Effect<R, unknown, A>;
      readonly handler: (error: unknown) => Effect<R, E, A>;
    };

// --- constructors (the only place the erasure casts live) ----------------
export const succeed = <A>(value: A): Effect<unknown, never, A> => ({ _tag: "Succeed", value });
export const failWith = <E>(error: E): Effect<unknown, E, never> => ({ _tag: "Fail", error });

export const suspend = <R, E, A>(
  thunk: (env: R, signal: AbortSignal) => Promise<Result<E, A>>,
  label?: string,
): Effect<R, E, A> => ({ _tag: "Suspend", thunk, label });

export const flatMap = <R, E, A, R2, E2, B>(
  e: Effect<R, E, A>,
  f: (a: A) => Effect<R2, E2, B>,
): Effect<R & R2, E | E2, B> => ({
  _tag: "FlatMap",
  first: e as unknown as Effect<R & R2, E | E2, unknown>,
  f: f as unknown as (x: unknown) => Effect<R & R2, E | E2, B>,
});

export const map = <R, E, A, B>(e: Effect<R, E, A>, f: (a: A) => B): Effect<R, E, B> =>
  flatMap(e, (a) => succeed(f(a)));

/** Recover from a typed failure with another effect. The recovery path may narrow E. */
export const catchAll = <R, E, A, E2>(
  e: Effect<R, E, A>,
  handler: (error: E) => Effect<R, E2, A>,
): Effect<R, E2, A> => ({
  _tag: "CatchAll",
  effect: e as unknown as Effect<R, unknown, A>,
  handler: handler as unknown as (error: unknown) => Effect<R, E2, A>,
});

/** retry ONLY accepts Replayable effects — re-running a non-idempotent effect is a TYPE ERROR. */
export const retry = <R, E, A>(
  e: Effect<R, E, A> & Replayable,
  times: number,
): Effect<R, E, A> & Replayable =>
  ({ _tag: "Retry", effect: e, times }) as unknown as Effect<R, E, A> & Replayable;

/** Generic bounded-concurrency fan-out. Under runMemory it's a promise pool; under runDist
 *  every child MUST be a `task` (Remote) — closures don't serialize. For a *type-safe*
 *  distributable fan-out, prefer `forEachTask`. */
export const forEachPar = <R, E, A, B>(
  items: readonly A[],
  f: (a: A) => Effect<R, E, B>,
  concurrency: number,
): Effect<R, E, B[]> =>
  ({
    _tag: "Par",
    effects: items.map(f) as unknown as ReadonlyArray<Effect<R, E, unknown>>,
    concurrency,
  }) as unknown as Effect<R, E, B[]>;

/** Type-safe distributable fan-out: takes a TaskDef, so children are guaranteed Remote and
 *  this runs identically (results-wise) under both interpreters. */
export const forEachTask = <In, Out, E>(
  items: readonly In[],
  t: TaskDef<In, Out, E>,
  concurrency: number,
): Effect<unknown, E, Out[]> =>
  ({
    _tag: "Par",
    effects: items.map((i) => t.effect(i)) as unknown as ReadonlyArray<Effect<unknown, E, unknown>>,
    concurrency,
  }) as unknown as Effect<unknown, E, Out[]>;

/** Discharge capabilities. `Pick<R,K>` rejects keys that aren't in R (a typo is a type error). */
export const provide = <R, K extends keyof R, E, A>(
  e: Effect<R, E, A>,
  layer: Pick<R, K>,
): Effect<Omit<R, K>, E, A> =>
  ({
    _tag: "Provide",
    layer: layer as Record<string, unknown>,
    effect: e as unknown as Effect<unknown, E, A>,
  }) as unknown as Effect<Omit<R, K>, E, A>;

// --- tasks: the distributable, idempotent unit ---------------------------
export interface TaskDef<In, Out, E = unknown> {
  readonly fnId: string;
  readonly keyOf: (input: In) => string;
  readonly impl: (input: In, ctx: TaskCtx) => Promise<Out>;
  readonly effect: (input: In) => Effect<unknown, E, Out> & Replayable;
}

/** Define a distributable task: a named function with a derived idempotency key. Its effect
 *  is Replayable (safe to retry). A thrown error is funneled into the typed E channel by the
 *  interpreter (E defaults to `unknown` — the thrown value; narrow it with `catchAll`). */
export const task = <In, Out, E = unknown>(
  fnId: string,
  keyOf: (input: In) => string,
  impl: (input: In, ctx: TaskCtx) => Promise<Out>,
): TaskDef<In, Out, E> => ({
  fnId,
  keyOf,
  impl,
  effect: (input: In) =>
    ({
      _tag: "Remote",
      fnId,
      args: input,
      key: keyOf(input),
      local: impl as (args: unknown, ctx: TaskCtx) => Promise<unknown>,
    }) as unknown as Effect<unknown, E, Out> & Replayable,
});
