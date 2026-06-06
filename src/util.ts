// util.ts — tiny internal helpers shared across the iii backend, examples, and demos.

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Invoke an iii function on a worker connection. One wrapper for the repeated
 *  `w.trigger({ function_id, payload })` shape (the SDK types `trigger` loosely). */
export const trigger = (
  w: { trigger(req: { function_id: string; payload: unknown }): unknown },
  fnId: string,
  payload: unknown,
): Promise<any> => w.trigger({ function_id: fnId, payload }) as Promise<any>;
