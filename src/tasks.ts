// tasks.ts — example distributable tasks shared by the demos.
import { task } from "./effect";
import { sleep } from "./util";

/** Uppercase (≈400ms). Idempotent: key = the input. ctx.idempotencyKey is available for
 *  real side-effecting tasks to dedupe at their provider (unused here — pure). */
export const upper = task<string, string>(
  "agentfx::upper",
  (s) => `upper:${s}`,
  async (s) => {
    await sleep(400);
    return s.toUpperCase();
  },
);

/** Length (≈200ms). */
export const lengthOf = task<string, number>(
  "agentfx::len",
  (s) => `len:${s}`,
  async (s) => {
    await sleep(200);
    return s.length;
  },
);

/** A task that THROWS on the input "boom" — to exercise the typed failure path. */
export const flaky = task<string, string>(
  "agentfx::flaky",
  (s) => `flaky:${s}`,
  async (s) => {
    await sleep(200);
    if (s === "boom") throw new Error(`task refused to process "${s}"`);
    return `ok:${s}`;
  },
);

export const allTasks = [upper, lengthOf, flaky];
