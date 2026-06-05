// demo.ts — `userMsgs.pipe(switchMap(react))` lowered to the iii epoch fence, LIVE.
//
// A new user message arrives 200ms into the previous turn's 800ms "inference".
// switchMap semantics: the new message preempts the old. We prove the HARD
// invariant — the tool fires ONLY for the latest message — two ways:
//   A) cancellable inference: the abort lands, old turn never reaches its tool.
//   B) NON-cancellable inference: the abort is ignored, the old turn's inference
//      returns a tool call anyway — and the FENCE refuses it. Correctness does
//      NOT depend on cancellation; it lives at the side-effect boundary.

import { bumpGen, fence, fireTool, readState, resetAgent } from "./iii";

const AGENT = "agent-7";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simulated "react" step: after llmMs the model proposes a tool call.
 *  If cancellable, an abort resolves early to 'aborted'; if not, it ignores abort. */
function reactStep(
  llmMs: number,
  signal: AbortSignal,
  cancellable: boolean,
): Promise<"aborted" | { tool: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ tool: "doThing" }), llmMs);
    if (cancellable) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve("aborted");
      });
    }
  });
}

/** Hand-written lowering of switchMap(react) onto the fence. */
async function runChat(
  text1: string,
  text2: string,
  opts: { llmMs: number; cancellable: boolean },
): Promise<void> {
  const box: { ac: AbortController | null } = { ac: null };

  const startTurn = async (G: number, text: string): Promise<void> => {
    const ac = new AbortController();
    box.ac = ac;
    const out = await reactStep(opts.llmMs, ac.signal, opts.cancellable); // think (SOFT-cancellable)
    if (out === "aborted") {
      console.log(`   gen${G}: inference aborted (soft preempt) — no tool`);
      return;
    }
    const fire = await fence(AGENT, G, 0); // TOOL BOUNDARY — THE FENCE
    if (!fire) {
      console.log(`   gen${G}: FENCE refused tool — a newer message exists`);
      return;
    }
    await fireTool(AGENT, G); // idempotent side effect
    console.log(`   gen${G}: tool FIRED (was current at commit)`);
  };

  // switchMap "switch": each message bumps gen + aborts the previous inner.
  const g1 = await bumpGen(AGENT);
  console.log(`USER -> gen${g1}: "${text1}"`);
  void startTurn(g1, text1);

  await sleep(200);
  box.ac?.abort();
  const g2 = await bumpGen(AGENT);
  console.log(`USER -> gen${g2}: "${text2}"  (preempts gen${g1})`);
  void startTurn(g2, text2);

  await sleep(opts.llmMs + 700); // let both turns settle
}

async function scenario(title: string, cancellable: boolean): Promise<void> {
  console.log(`\n=== ${title} ===`);
  await resetAgent(AGENT);
  await runChat("book a flight to NYC", "wait, make it SF", { llmMs: 800, cancellable });
  const st = await readState(AGENT);
  const fired: string[] = Object.keys(st.fired ?? {});
  const pass = fired.length === 1 && fired[0] === "2";
  console.log(
    `   -> tool fired for gens: [${fired.join(", ")}]   ${
      pass ? "PASS (only the latest input acted)" : "FAIL"
    }`,
  );
}

console.log("connecting to iii engine...");
await sleep(1500);
await scenario("A - cancellable inference: abort + fence", true);
await scenario("B - NON-cancellable inference: fence ALONE must save it", false);
console.log("\ndone.");
process.exit(0);
