// interpret.ts — two interpreters over the SAME reified Effect tree.
//
//   runMemory : pure, in-process. Remote runs its local impl; Par is a promise pool.
//   runDist   : backend-agnostic. Remote/Par discharge through a `Backend` (iii impl in
//               runtime-iii.ts); everything else runs in the driver process.
//
// Both funnel thrown/rejected impls into the typed `fail()` channel, so a throwing task
// never escapes as an unhandled rejection. They agree on results (see ex-differential.ts),
// including the failure path.

import { type Effect, type Result, Interrupted, fail, ok } from "./effect";

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
      try {
        return await e.thunk(env, signal);
      } catch (err) {
        return fail(err as E);
      }
    case "Remote":
      try {
        return ok((await e.local(e.args, { idempotencyKey: e.key })) as A);
      } catch (err) {
        return fail(err as E);
      }
    case "Provide":
      return runMemory(e.effect, { ...e.layer, ...(env as object) } as unknown as R, signal) as Promise<
        Result<E, A>
      >;
    case "FlatMap": {
      const r = await runMemory(e.first, env, signal);
      return r.ok ? runMemory(e.f(r.value), env, signal) : (r as Result<E, A>);
    }
    case "CatchAll": {
      const r = await runMemory(e.effect, env, signal);
      return r.ok ? (r as Result<E, A>) : runMemory(e.handler(r.error), env, signal);
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
      const box: { failure: Result<E, never> | null; done: number } = { failure: null, done: 0 };
      const lanes = Math.min(Math.max(1, e.concurrency), e.effects.length || 1);
      const worker = async (): Promise<void> => {
        while (cursor.next < e.effects.length && box.failure === null && !signal.aborted) {
          const i = cursor.next++;
          const r = await runMemory(e.effects[i], env, signal);
          if (r.ok) {
            results[i] = r.value;
            box.done++;
          } else {
            box.failure = r as Result<E, never>;
          }
        }
      };
      await Promise.all(Array.from({ length: lanes }, worker));
      if (box.failure) return box.failure;
      if (box.done < e.effects.length) return fail(new Interrupted() as unknown as E); // aborted mid-flight
      return ok(results as unknown as A);
    }
    default:
      return assertNever(e);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// runDist — the distributing interpreter (backend pluggable)
// ─────────────────────────────────────────────────────────────────────────
export interface Backend {
  /** Invoke a registered function on the runtime (non-durable direct call). */
  callRemote(fnId: string, args: unknown): Promise<unknown>;
  /** Fan a batch of registered tasks across the runtime, bounded by `concurrency`,
   *  at-least-once + crash-surviving. Rejects if any job ultimately fails. */
  parRemote(
    jobs: ReadonlyArray<{ fnId: string; args: unknown; key: string }>,
    concurrency: number,
  ): Promise<unknown[]>;
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
      try {
        return await e.thunk(env, signal);
      } catch (err) {
        return fail(err as E);
      }
    case "Remote":
      try {
        return ok((await be.callRemote(e.fnId, e.args)) as A);
      } catch (err) {
        return fail(err as E);
      }
    case "Provide":
      return runDist(e.effect, { ...e.layer, ...(env as object) } as unknown as R, be, signal) as Promise<
        Result<E, A>
      >;
    case "FlatMap": {
      const r = await runDist(e.first, env, be, signal);
      return r.ok ? runDist(e.f(r.value), env, be, signal) : (r as Result<E, A>);
    }
    case "CatchAll": {
      const r = await runDist(e.effect, env, be, signal);
      return r.ok ? (r as Result<E, A>) : runDist(e.handler(r.error), env, be, signal);
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
      // Distribution needs serializable units. A non-task child is programmer error — fail loud.
      const jobs = e.effects.map((child) => {
        if (child._tag !== "Remote") {
          throw new Error(
            "runDist can only distribute Par over `task` effects — closures don't serialize. Use forEachTask(items, taskDef, n).",
          );
        }
        return { fnId: child.fnId, args: child.args, key: child.key };
      });
      try {
        const results = await be.parRemote(jobs, e.concurrency);
        return ok(results as unknown as A);
      } catch (err) {
        return fail(err as E);
      }
    }
    default:
      return assertNever(e);
  }
}
