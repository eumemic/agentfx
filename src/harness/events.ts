// events.ts — the canonical, append-only event log entries. This IS the agent's state;
// everything else (context, status, "needs inference") is a pure function of this log.
//
// Mirrors aios: events are immutable, carry a gapless `seq`, and store provider-opaque `raw`
// so a model's native blocks (e.g. Claude thinking blocks) round-trip across wakes.

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

interface Base {
  /** gapless per-session sequence, assigned by the log on append. */
  readonly seq: number;
  /** which worker/driver instance wrote this event (provenance; proves crash hand-off). */
  readonly by?: string;
}

export interface UserEvent extends Base {
  readonly kind: "user";
  readonly text: string;
}

export interface AssistantEvent extends Base {
  readonly kind: "assistant";
  readonly text: string;
  readonly toolCalls: ToolCall[];
  /** max seq of user/tool_result events this turn reacted to — the watermark. */
  readonly reacting_to: number;
  /** provider-native content blocks, stored opaquely for faithful replay. */
  readonly raw?: unknown;
}

export interface ToolResultEvent extends Base {
  readonly kind: "tool_result";
  readonly toolCallId: string;
  readonly name: string;
  readonly result: string;
  readonly isError: boolean;
}

export type Event = UserEvent | AssistantEvent | ToolResultEvent;

/** An event to append, before the log assigns `seq`/`by`. */
export type DraftEvent =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; toolCalls: ToolCall[]; reacting_to: number; raw?: unknown }
  | { kind: "tool_result"; toolCallId: string; name: string; result: string; isError: boolean };
