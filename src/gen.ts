// gen.ts — derive TypeScript types from the contracts workers declared on the live engine.
//
// The engine is the IDL: every function that registered a request_format/response_format has
// its JSON Schema queryable via engine::functions::info. This walks the registry, converts
// each declared contract to a TS type, and writes src/contracts.generated.ts — a typed map of
// every fnId -> { input, output }, REGARDLESS of what language the worker is written in.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerWorker } from "iii-sdk";
import { sleep, trigger } from "./util";

const w = registerWorker(process.env.III_URL ?? "ws://localhost:49134", { workerName: "agentfx-codegen" });

/** Minimal JSON Schema -> TS type. Covers the shapes zod/typical workers emit; falls back to unknown. */
function tsType(s: any): string {
  if (!s || typeof s !== "object") return "unknown";
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (Array.isArray(s.enum)) return s.enum.map((v: unknown) => JSON.stringify(v)).join(" | ") || "never";
  if (Array.isArray(s.anyOf)) return s.anyOf.map(tsType).join(" | ");
  if (Array.isArray(s.oneOf)) return s.oneOf.map(tsType).join(" | ");
  const t = s.type;
  if (t === "string") return "string";
  if (t === "number" || t === "integer") return "number";
  if (t === "boolean") return "boolean";
  if (t === "null") return "null";
  if (t === "array") return `${tsType(s.items ?? {})}[]`;
  if (t === "object" || s.properties) {
    const props: Record<string, unknown> = s.properties ?? {};
    const required = new Set<string>(s.required ?? []);
    const fields = Object.entries(props).map(
      ([k, v]) => `${JSON.stringify(k)}${required.has(k) ? "" : "?"}: ${tsType(v)}`,
    );
    return fields.length ? `{ ${fields.join("; ")} }` : "Record<string, never>";
  }
  return "unknown";
}

async function main(): Promise<void> {
  await sleep(1200);
  const list = await trigger(w, "engine::functions::list", {});
  const fns: Array<{ function_id: string }> = list.functions ?? [];

  const rows: string[] = [];
  for (const f of fns) {
    const info = await trigger(w, "engine::functions::info", { function_id: f.function_id });
    const req = info?.request_schema;
    const res = info?.response_schema;
    if (!req && !res) continue; // only workers that DECLARED a contract
    rows.push(
      `  ${JSON.stringify(f.function_id)}: { input: ${req ? tsType(req) : "unknown"}; output: ${
        res ? tsType(res) : "unknown"
      } };`,
    );
  }
  rows.sort();

  const out =
    "// AUTO-GENERATED from the live iii engine by `npm run gen`. Do not edit by hand.\n" +
    "// Each entry's types are derived from that worker's declared contract — any language.\n\n" +
    `export interface Contracts {\n${rows.join("\n")}\n}\n`;

  const dir = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(dir, "contracts.generated.ts"), out);
  console.log(`wrote src/contracts.generated.ts with ${rows.length} declared contract(s):`);
  for (const r of rows) console.log("  " + r.trim());
  process.exit(0);
}

void main();
