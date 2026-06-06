// schema.ts — `schemaTask`: a task whose contract is ONE zod schema, which becomes three
// things at once:
//   • the static In/Out types (z.infer) — callers are compile-time checked
//   • a JSON Schema published to the engine (request_format/response_format) — discoverable
//     via `iii trigger <fn> --help`, usable by the console / LLM tool-use
//   • runtime validation at the boundary — a bad payload throws a ZodError, which the
//     interpreters funnel into the typed fail() channel (same as any other task failure)
//
// This makes the distributed wire crossing as typed as the in-memory composition: the
// `task()` boundary stops being trust-me.

import { z } from "zod";
import { type TaskCtx, type TaskDef, task } from "./effect";

export interface SchemaTaskDef<In, Out> extends TaskDef<In, Out, unknown> {
  readonly requestFormat: unknown;
  readonly responseFormat: unknown;
}

/** Define a task from zod input/output schemas. In/Out are inferred; the schema is
 *  published to the engine and enforced at the executor (and locally, for parity). */
export function schemaTask<I extends z.ZodType, O extends z.ZodType>(
  fnId: string,
  schemas: { input: I; output: O },
  impl: (input: z.infer<I>, ctx: TaskCtx) => Promise<z.infer<O>>,
  keyOf: (input: z.infer<I>) => string = (i) => JSON.stringify(i),
): SchemaTaskDef<z.infer<I>, z.infer<O>> {
  type In = z.infer<I>;
  type Out = z.infer<O>;

  // Validate at the boundary wherever the impl runs (executor under runDist, local under
  // runMemory) — so both interpreters reject bad payloads identically, as a typed failure.
  const validated = async (raw: unknown, ctx: TaskCtx): Promise<Out> => {
    const input = schemas.input.parse(raw) as In; // ZodError on bad input -> fail()
    const out = await impl(input, ctx);
    return schemas.output.parse(out) as Out;
  };

  const base = task<In, Out>(fnId, keyOf, validated);
  return Object.assign(base, {
    requestFormat: z.toJSONSchema(schemas.input),
    responseFormat: z.toJSONSchema(schemas.output),
  }) as SchemaTaskDef<In, Out>;
}
