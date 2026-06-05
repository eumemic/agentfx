// effect.ts — a REIFIED typed effect tree.
//
// Unlike a final/thunk encoding (where combinators execute inline), an Effect here
// is a *data structure* describing a computation. That lets multiple interpreters
// walk the same tree and discharge it differently — `runMemory` (in-process) and
// `runIII` (a durable distributed runtime). See interpret.ts.
//
// Two type laws survive the refactor (proven in laws.ts):
//   • capability tracking — you cannot run an Effect without supplying its R
//   • the Replayable brand — you cannot `retry` a non-idempotent Effect
//
// TS has no GADTs, so a reified tree must ERASE the intermediate types in FlatMap
// and the element types in Par. We contain that erasure to the constructors below
// (each marked); the public API stays fully typed.

export type Result<E, A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E };

export const ok = <A>(value: A): Result<never, A> => ({ ok: true, value });
export const fail = <E>(error: E): Result<E, never> => ({ ok: false, error });

declare const ReplayableTag: unique symbol;
/** Phantom evidence that an effect is safe to re-run. Only `task(...)` mints it. */
export interface Replayable {
  readonly [ReplayableTag]: true;
}

// --- the reified nodes (A and E are phantom on the union; carried by constructors) ---
export type Effect<R, E, A> =
  | { readonly _tag: "Succeed"; readonly value: A }
  | { readonly _tag: "Fail"; readonly error: E }
  | {
      readonly _tag: "Suspend";
      readonly thunk: (env: R, signal: AbortSignal) => Promise<Result<E, A>>;
      readonly label?: string;
    }
  // A distributable leaf: a registered function id + serializable args + dedup key.
  // Closures don't cross a queue, so distribution is only ever over these.
  | {
      readonly _tag: "Remote";
      readonly fnId: string;
      readonly args: unknown;
      readonly key: string;
      readonly local: (args: unknown) => Promise<unknown>; // for runMemory
    }
  | {
      readonly _tag: "FlatMap";
      readonly first: Effect<R, E, unknown>; // intermediate type erased
      readonly f: (x: unknown) => Effect<R, E, A>;
    }
  | {
      readonly _tag: "Par";
      readonly effects: ReadonlyArray<Effect<R, E, unknown>>; // element type erased; A = unknown[]
      readonly concurrency: number;
    }
  | { readonly _tag: "Retry"; readonly effect: Effect<R, E, A>; readonly times: number }
  | {
      readonly _tag: "Provide";
      readonly layer: Record<string, unknown>;
      readonly effect: Effect<unknown, E, A>;
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

/** retry ONLY accepts Replayable effects — re-running a non-idempotent effect is a TYPE ERROR. */
export const retry = <R, E, A>(
  e: Effect<R, E, A> & Replayable,
  times: number,
): Effect<R, E, A> & Replayable =>
  ({ _tag: "Retry", effect: e, times }) as unknown as Effect<R, E, A> & Replayable;

/** forEachPar: bounded-concurrency fan-out. In-memory it is a promise pool; lowered
 *  to iii it is a durable queue (children must be `task` Remotes — closures don't ship). */
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

export const provide = <R, P extends Partial<R>, E, A>(
  e: Effect<R, E, A>,
  layer: P,
): Effect<Omit<R, keyof P>, E, A> =>
  ({
    _tag: "Provide",
    layer: layer as Record<string, unknown>,
    effect: e as unknown as Effect<unknown, E, A>,
  }) as unknown as Effect<Omit<R, keyof P>, E, A>;

// --- tasks: the distributable, idempotent unit ---------------------------
export interface TaskDef<In, Out> {
  readonly fnId: string;
  readonly keyOf: (input: In) => string;
  readonly impl: (input: In) => Promise<Out>;
  /** Build the (Replayable) effect node for one input. */
  readonly effect: (input: In) => Effect<unknown, never, Out> & Replayable;
}

/** Define a distributable task: a named, idempotent function. Its effect is Replayable
 *  (safe to retry) and runs locally under runMemory or on the engine under runIII. */
export const task = <In, Out>(
  fnId: string,
  keyOf: (input: In) => string,
  impl: (input: In) => Promise<Out>,
): TaskDef<In, Out> => ({
  fnId,
  keyOf,
  impl,
  effect: (input: In) =>
    ({
      _tag: "Remote",
      fnId,
      args: input,
      key: keyOf(input),
      local: impl as (args: unknown) => Promise<unknown>,
    }) as unknown as Effect<unknown, never, Out> & Replayable,
});
