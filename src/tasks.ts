// tasks.ts — example distributable tasks shared by the demos.
import { task } from "./effect";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Uppercase a string (simulated ~400ms of work). Idempotent: key = the input. */
export const upper = task<string, string>(
  "aionfx::upper",
  (s) => `upper:${s}`,
  async (s) => {
    await sleep(400);
    return s.toUpperCase();
  },
);

/** Length of a string (simulated ~200ms). */
export const lengthOf = task<string, number>(
  "aionfx::len",
  (s) => `len:${s}`,
  async (s) => {
    await sleep(200);
    return s.length;
  },
);

export const allTasks = [upper, lengthOf];
