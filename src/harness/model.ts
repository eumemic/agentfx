// model.ts — the model is an injected interface, so the harness is provider-agnostic. A step
// hands the model a windowed slice of the (canonical) event log; the model returns one turn:
// some text, zero-or-more tool calls, and optional provider-native `raw` blocks to persist.

import type { Event, ToolCall } from "./events";

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
  /** provider-native content blocks to store on the assistant event for faithful replay. */
  raw?: unknown;
}

export interface Model {
  step(input: { events: Event[]; tools: ToolSpec[]; system?: string }): Promise<ModelTurn>;
}
