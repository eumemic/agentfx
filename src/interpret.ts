// interpret.ts — ONE tree-walk, two strategies.
//
// The reified Effect tree is walked by `walk`, which handles every structural node
// (Succeed/Fail/Suspend/FlatMap/CatchAll/Retry/Provide) once. The two interpreters differ
// only in how the two genuinely-different leaves discharge — `Remote` and `Par`:
//
//   runMemory : Remote runs its local impl; Par is an in-process promise pool.
//   runDist   : Remote/Par go through a `Backend` (the iii impl in runtime-iii.ts).
//
// Because the shared cases live in one place, the two interpreters can't drift — which is
// exactly the invariant ex-differential.ts checks. Both funnel a thrown impl into fail().

import { type Effect, type Result, type TaskCtx, Interrupted, fail, ok } from "./effect";

const assertNever = (x: never): never => {
  throw new Error(`unhandled effect node: ${JSON.stringify(x)}`);
};

type Run<E> = <A>(e: Effect<unknown, E, A>, env: unknown, signal: AbortSignal) => Promise<Result<E, A>>;

/** How an interpreter discharges the two leaves that actually differ. */
interface Interp<E> {
  remote(node: {
    fnId: string;
    args: unknown;
    key: string;
    local: (args: unknown, ctx: TaskCtx) => Promise<unknown>;
  }): Promise<Result<E, unknown>>;
  par(
    // R is contravariant and the strategies don't read env's type — accept any node shape.
    node: { effects: ReadonlyArray<Effect<any, E, unknown>>; concurrency: number },
    env: unknown,
    signal: AbortSignal,
    run: Run<E>,
  ): Promise<Result<E, unknown[]>>;
}

async function walk<R, E, A>(
  e: Effect<R, E, A>,
  env: R,
  signal: AbortSignal,
  interp: Interp<E>,
): Promise<Result<E, A>> {
  const run: Run<E> = (ee, en, sig) => walk(ee, en, sig, interp);
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
      return interp.remote(e) as Promise<Result<E, A>>;
    case "Par":
      return interp.par(e, env, signal, run) as Promise<Result<E, A>>;
    case "Provide":
      return walk(e.effect, { ...e.layer, ...(env as object) } as unknown as R, signal, interp) as Promise<
        Result<E, A>
      >;
    case "FlatMap": {
      const r = await walk(e.first, env, signal, interp);
      return r.ok ? walk(e.f(r.value), env, signal, interp) : (r as Result<E, A>);
    }
    case "CatchAll": {
      const r = await walk(e.effect, env, signal, interp);
      return r.ok ? (r as Result<E, A>) : walk(e.handler(r.error), env, signal, interp);
    }
    case "Retry": {
      let last: Result<E, A> | undefined;
      for (let i = 0; i <= e.times && !signal.aborted; i++) {
        last = await walk(e.effect, env, signal, interp);
        if (last.ok) return last;
      }
      return last ?? fail(new Interrupted() as unknown as E); // only reached if pre-aborted
    }
    default:
      return assertNever(e);
  }
}

// ── runMemory: the reference strategy ──────────────────────────────────────
export function runMemory<R, E, A>(
  e: Effect<R, E, A>,
  env: R,
  signal: AbortSignal = new AbortController().signal,
): Promise<Result<E, A>> {
  return walk(e, env, signal, {
    async remote(node) {
      try {
        return ok(await node.local(node.args, { idempotencyKey: node.key }));
      } catch (err) {
        return fail(err as E);
      }
    },
    async par(node, penv, psig, prun) {
      const results: unknown[] = new Array(node.effects.length);
      let next = 0;
      let failure: Result<E, never> | null = null;
      const lanes = Math.max(1, Math.min(node.concurrency, node.effects.length || 1));
      const lane = async (): Promise<void> => {
        while (next < node.effects.length && failure === null && !psig.aborted) {
          const i = next++;
          const r = await prun(node.effects[i], penv, psig);
          if (r.ok) results[i] = r.value;
          else failure = r as Result<E, never>;
        }
      };
      await Promise.all(Array.from({ length: lanes }, lane));
      if (failure) return failure;
      if (next < node.effects.length) return fail(new Interrupted() as unknown as E); // aborted mid-flight
      return ok(results);
    },
  });
}

// ── runDist: the distributing strategy (backend pluggable) ─────────────────
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

export function runDist<R, E, A>(
  e: Effect<R, E, A>,
  env: R,
  be: Backend,
  signal: AbortSignal = new AbortController().signal,
): Promise<Result<E, A>> {
  return walk(e, env, signal, {
    async remote(node) {
      try {
        return ok(await be.callRemote(node.fnId, node.args));
      } catch (err) {
        return fail(err as E);
      }
    },
    async par(node) {
      // Distribution needs serializable units. A non-task child is programmer error — fail loud.
      const jobs = node.effects.map((child) => {
        if (child._tag !== "Remote") {
          throw new Error(
            "runDist can only distribute Par over `task` effects — closures don't serialize. Use forEachTask(items, taskDef, n).",
          );
        }
        return { fnId: child.fnId, args: child.args, key: child.key };
      });
      try {
        return ok(await be.parRemote(jobs, node.concurrency));
      } catch (err) {
        return fail(err as E);
      }
    },
  });
}
