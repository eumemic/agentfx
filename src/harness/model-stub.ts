// model-stub.ts — a deterministic "model" for the durability proof: no API, fully reproducible.
// It reads the event log (its only input) and drives the canonical demo turn:
//   no add results yet      → call add(21, 21)
//   one add result (42)     → call add(42, 100)
//   two add results (142)   → final answer "142"
// Determinism is what lets the kill-9 proof land on an exact, repeatable point.

import type { Event } from "./events";
import type { Model, ModelTurn } from "./model";

export function stubModel(): Model {
  return {
    async step({ events }): Promise<ModelTurn> {
      const adds = events.filter((e): e is Extract<Event, { kind: "tool_result" }> => e.kind === "tool_result" && e.name === "add");
      if (adds.length === 0) {
        return { text: "Adding 21 and 21.", toolCalls: [{ id: crypto.randomUUID(), name: "add", input: { a: 21, b: 21 } }] };
      }
      const last = Number(adds[adds.length - 1].result);
      if (adds.length === 1) {
        return { text: `Got ${last}. Now adding 100.`, toolCalls: [{ id: crypto.randomUUID(), name: "add", input: { a: last, b: 100 } }] };
      }
      return { text: String(last), toolCalls: [] };
    },
  };
}
