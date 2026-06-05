// ex-executor.ts — the executor process. Registers the example tasks + the generic
// batch subscriber, then stays alive (the WS connection keeps the event loop busy).
import { startExecutor } from "./runtime-iii";
import { allTasks } from "./tasks";

startExecutor(allTasks, { concurrency: 3 });
