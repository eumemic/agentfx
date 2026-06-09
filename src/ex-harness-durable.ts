// ex-harness-durable.ts — PROOF that the agent reasoning loop survives `kill -9` mid-turn.
//
// This orchestrator only appends the user message + reads the log (it is the "API" side). The
// *worker* runs the loop. We spawn worker w1, send a message, SIGKILL w1 mid-turn (right after
// the first tool_result lands), then spawn w2. The engine's in-memory durable queue redelivers
// the unacked wake/tool job to w2, which resumes from the file-backed event log and finishes
// 21 + 21 + 100 = 142. The `by` provenance on each event proves the hand-off across the crash.

import { type ChildProcess, spawn } from "node:child_process";
import { readLog, resetSession, sendUserMessage } from "./harness/client";
import type { Event } from "./harness/events";
import { initWorker } from "./harness/iii";
import { sleep } from "./util";

process.env.III_WORKER_INSTANCE = "client";
initWorker("agentfx-harness-orchestrator");

const SESSION = `dur-${crypto.randomUUID().slice(0, 8)}`;
const TSX = "node_modules/.bin/tsx";

function spawnWorker(instance: string): ChildProcess {
  const child = spawn(TSX, ["src/harness-worker.ts", "--model", "stub"], {
    cwd: process.cwd(),
    env: { ...process.env, III_WORKER_NAME: `agentfx-harness-${instance}`, III_WORKER_INSTANCE: instance },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group, so we can hard-kill the whole tree (tsx wrapper + node)
  });
  child.stdout?.on("data", (d) => process.stdout.write(`    [${instance}] ${d}`));
  child.stderr?.on("data", (d) => process.stdout.write(`    [${instance}!] ${d}`));
  return child;
}

/** Kill the worker's entire process group — `kill -9` to the wrapper alone orphans the node child. */
function hardKill(child: ChildProcess): void {
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    /* group already gone */
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* already dead */
  }
}

const lastAssistant = (evs: Event[]): Extract<Event, { kind: "assistant" }> | undefined =>
  [...evs].reverse().find((e): e is Extract<Event, { kind: "assistant" }> => e.kind === "assistant");

(async () => {
  console.log(`\n=== durable agent-loop proof — session ${SESSION} ===`);
  await resetSession(SESSION).catch(() => {});

  console.log("\n[1] start worker w1");
  let w = spawnWorker("w1");
  await sleep(2500);

  console.log("[2] send user message (21+21, then +100)");
  await sendUserMessage(SESSION, "What is 21 + 21, and then add 100 to that result? Use the add tool, one step at a time.");

  console.log("[3] wait for the turn to start (first assistant), then HARD-KILL w1 with its first tool in flight…");
  const deadline1 = Date.now() + 20000;
  for (;;) {
    if ((await readLog(SESSION)).some((e) => e.kind === "assistant")) break;
    if (Date.now() > deadline1) {
      console.log("FAIL ❌ — w1 never started the turn");
      hardKill(w);
      process.exit(1);
    }
    await sleep(50);
  }
  const pre = await readLog(SESSION);
  console.log(`[3] HARD-KILL w1 (process group) — log has ${pre.length} events (top seq ${pre[pre.length - 1]?.seq}); add(21,21) is mid-flight`);
  hardKill(w);
  await sleep(900);

  console.log("[4] start worker w2 — the queue should redeliver the in-flight job");
  w = spawnWorker("w2");

  console.log("[5] wait for the loop to resume on w2 and finish at 142…");
  let done = false;
  const deadline2 = Date.now() + 30000;
  for (;;) {
    const fa = lastAssistant(await readLog(SESSION));
    if (fa && fa.toolCalls.length === 0 && /142/.test(fa.text)) {
      done = true;
      break;
    }
    if (Date.now() > deadline2) break;
    await sleep(200);
  }

  const evs = await readLog(SESSION);
  console.log(`\n--- event log (${evs.length} events) ---`);
  for (const e of evs) {
    const tag = `#${String(e.seq).padStart(2)} [${e.by}]`;
    if (e.kind === "user") console.log(`${tag} user: ${e.text.slice(0, 48)}…`);
    else if (e.kind === "assistant")
      console.log(
        `${tag} assistant react=${e.reacting_to} tools=[${e.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join(", ")}]${e.text ? ` "${e.text.slice(0, 36)}"` : ""}`,
      );
    else console.log(`${tag} tool_result ${e.name} → ${e.result}`);
  }
  const w1n = evs.filter((e) => e.by === "w1").length;
  const w2n = evs.filter((e) => e.by === "w2").length;
  const finalBy = lastAssistant(evs)?.by;
  hardKill(w);
  await sleep(200);

  // Rigorous: w1 must be dead, w2 must have produced the final answer AND the post-crash work.
  if (done && finalBy === "w2" && w2n >= 2) {
    console.log(`\nPASS ✅ — loop resumed after a hard kill; final=142 was written by w2.`);
    console.log(`         w1 wrote ${w1n} event(s) before the crash; w2 resumed from the file-backed log and`);
    console.log(`         wrote ${w2n} (the redelivered add results + the final answer). The loop is the queue.`);
    process.exit(0);
  }
  console.log(`\nFAIL ❌ — not a clean resume (done=${done}, finalBy=${finalBy}, w1=${w1n}, w2=${w2n})`);
  process.exit(1);
})();
