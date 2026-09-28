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
if (fixtures.schema_version !== "0.2") throw new Error("Unsupported fixture version");
const renderBytes = await readFile(join(here, "ocr-render.json"));
const renderConfig = JSON.parse(renderBytes.toString("utf8"));
if (renderConfig.schema_version !== "0.2" || renderConfig.status !== "not_rendered") throw new Error("Unexpected OCR render state");
for (const item of fixtures.tool_calls) {
  if (item.expected_tool !== item.tool_schema.name && item.expected_tool !== null) throw new Error(`Invalid expected tool: ${item.id}`);
  if (item.expected_tool === null && item.expected_arguments !== null) throw new Error(`No-call fixture has arguments: ${item.id}`);
  if (item.expected_tool !== null && (item.expected_arguments === null || !item.tool_schema.parameters.required.every((name) => name in item.expected_arguments))) throw new Error(`Tool arguments incomplete: ${item.id}`);
}
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
const supersededIds = new Set(fixtures.evidence_sources.map((source) => source.supersedes).filter(Boolean));
for (const item of fixtures.dated_facts) {
  // Minimal dated-evidence gate; sources are fictional and fixture-local.
  const candidates = fixtures.evidence_sources.filter((source) => source.fact_key === item.fact_key
    && source.status === "current" && !supersededIds.has(source.id)
    && source.effective_from <= item.as_of
    && (!source.effective_to || item.as_of <= source.effective_to));
  const values = new Set(candidates.map((source) => source.value));
  const observed = values.size === 1 ? candidates[0].value : "abstain";
  const sourceIds = observed === "abstain" ? [] : candidates.map((source) => source.id).sort();
  const expectedIds = [...item.expected_source_ids].sort();
  const pass = observed === item.gold && JSON.stringify(sourceIds) === JSON.stringify(expectedIds);
  rows.push({ id: item.id, lane: "dated_fact_policy", status: pass ? "pass" : "fail", observed, expected: item.gold, source_ids: sourceIds, candidate_source_ids: candidates.map((source) => source.id), reason: values.size > 1 ? "conflicting_current_sources" : values.size === 0 ? "no_current_source" : "current_source" });
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
  benchmark: "thai-intelligence-offline-v0.2",
  provenance: { repository_revision: revision, fixture_sha256: createHash("sha256").update(bytes).digest("hex"), ocr_render_manifest_sha256: createHash("sha256").update(renderBytes).digest("hex"), asset_sha256: assetSha256, rendered_png_sha256: null, runtime: process.version, model: null, decoder: null, external_requests: 0, cost_usd: 0 },
  baseline: { retrieval: "@itops/mcp-rag foldThai lexical containment", legal: "@itops/mcp-legal legalSearch fixture corpus", dated_facts: "fictional dated-source selection/conflict abstention policy" },
  counts,
  rows,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (counts.fail) process.exitCode = 1;
