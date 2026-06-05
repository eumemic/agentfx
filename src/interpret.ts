// interpret.ts — two interpreters over the SAME reified Effect tree.
//
//   runMemory : pure, in-process. Remote runs its local impl; Par is a promise pool.
//   runDist   : backend-agnostic. Remote/Par are discharged through a `Backend`
//               (the iii implementation lives in runtime-iii.ts). Everything else
//               runs in the driver process.
//
// The point: one typed program, two interpreters, identical results (see ex-differential.ts).

import { type Effect, type Result, fail, ok } from "./effect";

const assertNever = (x: never): never => {
  throw new Error(`unhandled effect node: ${JSON.stringify(x)}`);
};

// ─────────────────────────────────────────────────────────────────────────
// runMemory — the reference interpreter
// ─────────────────────────────────────────────────────────────────────────
export async function runMemory<R, E, A>(
  e: Effect<R, E, A>,
  env: R,
  signal: AbortSignal = new AbortController().signal,
): Promise<Result<E, A>> {
  switch (e._tag) {
    case "Succeed":
      return ok(e.value);
    case "Fail":
      return fail(e.error);
    case "Suspend":
      return e.thunk(env, signal);
    case "Remote":
      return ok((await e.local(e.args)) as A);
    case "Provide":
      return runMemory(e.effect, { ...e.layer, ...(env as object) } as unknown as R, signal) as Promise<
        Result<E, A>
      >;
    case "FlatMap": {
      const r = await runMemory(e.first, env, signal);
      return r.ok ? runMemory(e.f(r.value), env, signal) : (r as Result<E, A>);
    }
    case "Retry": {
      let last: Result<E, A> = fail(undefined as unknown as E);
      for (let i = 0; i <= e.times && !signal.aborted; i++) {
        last = await runMemory(e.effect, env, signal);
        if (last.ok) return last;
      }
      return last;
    }
    case "Par": {
      const results: unknown[] = new Array(e.effects.length);
      const cursor = { next: 0 };
      const box: { failure: Result<E, never> | null } = { failure: null };
      const lanes = Math.min(Math.max(1, e.concurrency), e.effects.length || 1);
      const worker = async (): Promise<void> => {
        while (cursor.next < e.effects.length && box.failure === null && !signal.aborted) {
          const i = cursor.next++;
          const r = await runMemory(e.effects[i], env, signal);
          if (r.ok) results[i] = r.value;
          else box.failure = r as Result<E, never>;
        }
      };
      await Promise.all(Array.from({ length: lanes }, worker));
      return box.failure ?? ok(results as unknown as A);
    }
    default:
      return assertNever(e);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// runDist — the distributing interpreter (backend pluggable)
// ─────────────────────────────────────────────────────────────────────────
export interface Backend {
  /** Invoke a registered function on the runtime. */
  callRemote(fnId: string, args: unknown): Promise<unknown>;
  /** Fan a batch of registered tasks across the runtime, bounded by the runtime's
   *  own concurrency (a deployment setting), at-least-once + crash-surviving. */
  parRemote(jobs: ReadonlyArray<{ fnId: string; args: unknown; key: string }>): Promise<unknown[]>;
}

export async function runDist<R, E, A>(
  e: Effect<R, E, A>,
  env: R,
  be: Backend,
  signal: AbortSignal = new AbortController().signal,
): Promise<Result<E, A>> {
  switch (e._tag) {
    case "Succeed":
      return ok(e.value);
    case "Fail":
      return fail(e.error);
    case "Suspend":
      return e.thunk(env, signal); // local-only node: runs in the driver
    case "Remote":
      return ok((await be.callRemote(e.fnId, e.args)) as A);
    case "Provide":
      return runDist(e.effect, { ...e.layer, ...(env as object) } as unknown as R, be, signal) as Promise<
        Result<E, A>
      >;
    case "FlatMap": {
      const r = await runDist(e.first, env, be, signal);
      return r.ok ? runDist(e.f(r.value), env, be, signal) : (r as Result<E, A>);
    }
    case "Retry": {
      let last: Result<E, A> = fail(undefined as unknown as E);
      for (let i = 0; i <= e.times && !signal.aborted; i++) {
        last = await runDist(e.effect, env, be, signal);
        if (last.ok) return last;
      }
      return last;
    }
    case "Par": {
      // Distribution requires serializable units — closures don't ship over a queue.
      const jobs = e.effects.map((child) => {
        if (child._tag !== "Remote") {
          throw new Error(
            "runDist can only distribute Par over `task` (Remote) effects — closures do not serialize. " +
              "Wrap the work in task(fnId, keyOf, impl).",
          );
        }
        return { fnId: child.fnId, args: child.args, key: child.key };
      });
      const results = await be.parRemote(jobs);
      return ok(results as unknown as A);
    }
    default:
      return assertNever(e);
  }
}
