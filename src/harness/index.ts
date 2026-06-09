// index.ts — public surface of the durable agent harness.

export type { Event, DraftEvent, ToolCall, UserEvent, AssistantEvent, ToolResultEvent } from "./events";
export type { Model, ModelTurn, ToolSpec } from "./model";
export type { ToolImpl } from "./tools";
export type { StepDeps } from "./step";
export type { HarnessWorkerOpts } from "./worker";

export { initWorker, getW, WAKE_TOPIC, TOOL_TOPIC } from "./iii";
export { appendEvent, readLog, resetSession, nextSeq } from "./log";
export { selectWindow } from "./window";
export { needsInference, maxReacting, reactingTo, unresolvedToolCalls, hasToolResult } from "./sweep";
export { runStep } from "./step";
export { dispatchTool, handleToolJob } from "./tools";
export { startHarnessWorker } from "./worker";
export { sendUserMessage } from "./client";
export { stubModel } from "./model-stub";
export { claudeModel } from "./model-claude";
