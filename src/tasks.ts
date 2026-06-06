// tasks.ts — example distributable tasks shared by the demos.
import { z } from "zod";
import { task } from "./effect";
import { schemaTask } from "./schema";
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

/** A schema-typed task: input/output inferred from zod, the schema published to the engine,
 *  and bad payloads rejected at the boundary. `greet({name, times})` -> "hi <name>" * times. */
export const greet = schemaTask(
  "agentfx::greet",
  {
    input: z.object({ name: z.string().min(1), times: z.number().int().min(1).max(5) }),
    output: z.string(),
  },
  async ({ name, times }) => {
    await sleep(150);
    return Array.from({ length: times }, () => `hi ${name}`).join(" ");
  },
);

export const allTasks = [upper, lengthOf, flaky, greet];
