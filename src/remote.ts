// remote.ts — a typed call into ANY worker's function, with In/Out derived from that worker's
// declared contract (src/contracts.generated.ts, produced by `npm run gen`). The implementing
// worker can be in any language; TypeScript gets the types for free from the engine's registry.

import type { Effect, Replayable } from "./effect";
import type { Contracts } from "./contracts.generated";

export type ContractId = keyof Contracts;

/** Build a typed effect that invokes `fnId` on whatever worker implements it. In/Out come from
 *  the generated contract. Runs under runDist (the engine routes to the implementing worker);
 *  it has no in-process impl, so runMemory fails it — these are cross-worker contracts, not
 *  local tasks. */
export function remote<K extends ContractId>(
  fnId: K,
): (input: Contracts[K]["input"]) => Effect<unknown, unknown, Contracts[K]["output"]> & Replayable {
  return (input) =>
    ({
      _tag: "Remote",
      fnId: fnId as string,
      args: input,
      key: JSON.stringify(input),
      local: async () => {
        throw new Error(`remote-only contract '${String(fnId)}': no in-process impl (use runDist)`);
      },
    }) as unknown as Effect<unknown, unknown, Contracts[K]["output"]> & Replayable;
}
