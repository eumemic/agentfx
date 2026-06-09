// iii.ts — the harness's single iii-sdk connection + thin helpers over the engine primitives
// it lowers onto: file-backed atomic state (the event log) and the in-memory durable queue
// (the wake/tool transport). Worker is created lazily so each process (worker, client,
// orchestrator) can pick its own label at runtime via III_WORKER_NAME / III_WORKER_INSTANCE.

import { registerWorker } from "iii-sdk";
import { trigger } from "../util";

const URL = process.env.III_URL ?? "ws://localhost:49134";

export const WAKE_TOPIC = "agentfx.harness.wake"; // {sessionId} → run a step
export const TOOL_TOPIC = "agentfx.harness.tool"; // {sessionId,toolCallId,name,input} → run a tool
export const META_SCOPE = "agentfx_harness_meta"; // per-session monotonic seq counter
export const ATTEMPT_SCOPE = "agentfx_harness_attempts"; // per-session bounded model-retry counters
export const logScope = (sessionId: string): string => `agentfx_harness_log_${sessionId}`;

type W = ReturnType<typeof registerWorker>;
let _w: W | null = null;

/** Register (once) this process's worker connection. Safe to call repeatedly. */
export function initWorker(name?: string): W {
  if (!_w) {
    _w = registerWorker(URL, { workerName: name ?? process.env.III_WORKER_NAME ?? "agentfx-harness" });
  }
  return _w;
}
export const getW = (): W => _w ?? initWorker();

/** Provenance label stamped on appended events — proves which instance wrote what. */
export const instanceLabel = (): string =>
  process.env.III_WORKER_INSTANCE ?? process.env.III_WORKER_NAME ?? "agentfx-harness";

// durable queue
export const pub = (topic: string, data: unknown): Promise<unknown> =>
  trigger(getW(), "iii::durable::publish", { topic, data });

// atomic, file-backed state (the log lives here)
export const stGet = (scope: string, key: string): Promise<any> => trigger(getW(), "state::get", { scope, key });
export const stSet = (scope: string, key: string, value: unknown): Promise<any> =>
  trigger(getW(), "state::set", { scope, key, value });
export const stUpdate = (scope: string, key: string, ops: unknown[]): Promise<any> =>
  trigger(getW(), "state::update", { scope, key, ops });
export const stDelete = (scope: string, key: string): Promise<any> => trigger(getW(), "state::delete", { scope, key });
export const stList = (scope: string): Promise<unknown[]> => trigger(getW(), "state::list", { scope }) as Promise<unknown[]>;
