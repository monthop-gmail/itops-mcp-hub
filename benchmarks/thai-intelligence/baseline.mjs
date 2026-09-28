import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { foldThai } from "../../packages/mcp-rag/dist/thai-normalize.js";
import { legalSearch } from "../../packages/mcp-legal/dist/corpus.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const bytes = await readFile(join(here, "fixtures.json"));
const fixtures = JSON.parse(bytes.toString("utf8"));
if (fixtures.schema_version !== "0.1") throw new Error("Unsupported fixture version");
const assetSha256 = Object.fromEntries(await Promise.all(fixtures.ocr.map(async (item) => {
  const asset = await readFile(join(here, item.asset));
  return [item.asset, createHash("sha256").update(asset).digest("hex")];
})));

const rows = [];
for (const item of fixtures.retrieval) {
  // Existing normalization is only a deterministic lexical baseline, not semantic search.
  const found = foldThai(item.document).includes(foldThai(item.query));
  rows.push({ id: item.id, lane: "retrieval", status: found === item.expected_match ? "pass" : "fail", observed: found, expected: item.expected_match });
}
for (const item of fixtures.legal) {
  const hits = legalSearch(item.query, item.as_of);
  const selected = hits.find((hit) => hit.effective_status === "current") ?? null;
  const target = hits.find((hit) => hit.section === item.expected_section) ?? null;
  const observed = target?.effective_status ?? "absent";
  rows.push({ id: item.id, lane: "legal_retrieval", status: observed === item.expected_status ? "pass" : "fail", observed, expected: item.expected_status, selected_section: selected?.section ?? null, evidence_id: target?.evidence_id ?? null });
}
for (const item of fixtures.dated_facts) {
  // Fail-closed source policy: no evidence registry record means abstain.
  rows.push({ id: item.id, lane: "dated_fact_policy", status: item.gold === "abstain" ? "pass" : "fail", observed: "abstain", expected: item.gold });
}
for (const [lane, items] of [["language_generation", fixtures.language], ["ocr", fixtures.ocr], ["tool_calling", fixtures.tool_calls]]) {
  for (const item of items) rows.push({ id: item.id, lane, status: "not_tested", reason: "No offline deterministic current-system baseline for this capability" });
}

const counts = rows.reduce((out, row) => { out[row.status] = (out[row.status] ?? 0) + 1; return out; }, {});
const head = (await readFile(join(root, ".git/HEAD"), "utf8")).trim();
const revision = head.startsWith("ref: ")
  ? (await readFile(join(root, ".git", head.slice(5)), "utf8")).trim()
  : head;
const result = {
  benchmark: "thai-intelligence-offline-v0.1",
  provenance: { repository_revision: revision, fixture_sha256: createHash("sha256").update(bytes).digest("hex"), asset_sha256: assetSha256, runtime: process.version, model: null, decoder: null, external_requests: 0, cost_usd: 0 },
  baseline: { retrieval: "@itops/mcp-rag foldThai lexical containment", legal: "@itops/mcp-legal legalSearch fixture corpus", dated_facts: "no-source abstention policy" },
  counts,
  rows,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (counts.fail) process.exitCode = 1;
