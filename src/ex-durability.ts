// ex-durability.ts — the distributed interpreter inherits crash-survival. Fan out 12 tasks
// via runDist; SIGKILL the executor mid-batch (see the npm script / killer); at-least-once
// redelivery to the restarted executor completes every task.

import { forEachTask } from "./effect";
import { runDist } from "./interpret";
import { makeIIIBackend } from "./runtime-iii";
import { upper } from "./tasks";
import { sleep } from "./util";
const items = Array.from({ length: 12 }, (_, i) => `task-${i}`);

console.log("connecting to engine...");
await sleep(1500);

console.log(`\n=== runDist over ${items.length} tasks; executor killed mid-batch ===`);
const be = makeIIIBackend();
const t0 = Date.now();
const r = await runDist(forEachTask(items, upper, 3), {}, be, new AbortController().signal);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

if (r.ok) {
  console.log(`\nall ${r.value.length}/${items.length} completed in ${secs}s — despite the kill`);
  console.log("results:", r.value.join(", "));
  process.exit(0);
} else {
  console.log("FAILED:", String((r.error as Error)?.message ?? r.error));
  process.exit(1);
}
