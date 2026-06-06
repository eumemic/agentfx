// iii.ts — the LOWERING of `switchMap` onto iii's epoch fence, on the live engine.
//
// Each primitive is one call to the iii state worker. The fence is the verified
// claim-once op: a single atomic `state::update` that reads freshness (old.gen)
// AND records the commit marker in the same linearized critical section.

import { registerWorker } from "iii-sdk";
import { trigger } from "./util";

const worker = registerWorker(process.env.III_URL ?? "ws://localhost:49134", {
  workerName: "agentfx",
});

const SCOPE = "agentfx";
const call = (fn: string, payload: unknown): Promise<any> => trigger(worker, fn, payload);

export const resetAgent = (agentId: string): Promise<unknown> =>
  call("state::delete", { scope: SCOPE, key: agentId });

export const readState = async (agentId: string): Promise<any> =>
  (await call("state::get", { scope: SCOPE, key: agentId })) ?? {};

/** ingest: atomically bump the agent's generation; returns THIS message's immutable gen. */
export async function bumpGen(agentId: string): Promise<number> {
  const r = await call("state::update", {
    scope: SCOPE,
    key: agentId,
    ops: [{ type: "increment", path: "gen", by: 1 }],
  });
  return r.new_value.gen as number;
}

/** THE FENCE. One atomic op both READS freshness (old.gen) and CLAIMS the marker.
 *  Fire iff the turn's immutable gen G is still the latest AND this step is unclaimed.
 *  There is no check-then-act window because check and claim are the same op. */
export async function fence(agentId: string, G: number, step: number): Promise<boolean> {
  const marker = `${G}#${step}`;
  const r = await call("state::update", {
    scope: SCOPE,
    key: agentId,
    ops: [{ type: "merge", path: "commit", value: { [marker]: G } }],
  });
  const old = r.old_value ?? {};
  const curGen: number = old.gen ?? 0;
  const alreadyClaimed = (old.commit ?? {})[marker] !== undefined;
  return curGen === G && !alreadyClaimed;
}

/** the (idempotent) tool side effect: record that gen G's tool fired. */
export async function fireTool(agentId: string, G: number): Promise<void> {
  await call("state::update", {
    scope: SCOPE,
    key: agentId,
    ops: [{ type: "merge", path: "fired", value: { [String(G)]: Date.now() } }],
  });
}
