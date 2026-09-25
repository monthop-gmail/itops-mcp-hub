import { fixtureCorpus } from "./corpus.js";
import { LegalService } from "./service.js";
import type { LegalAnswer, LegalInference } from "./types.js";

const asOf = "2026-09-25";
export const cases = [
  { id: "current-10", question: "มาตรา 10", section: "10" },
  { id: "near-miss-11", question: "มาตรา 11", section: "11" },
  { id: "expired-12", question: "มาตรา 12", section: null },
  { id: "unknown-date-13", question: "มาตรา 13", section: null },
  { id: "absent-99", question: "มาตรา 99", section: null },
] as const;

export function assess(answer: LegalAnswer, expectedSection: string | null, retrievalOnly: boolean): { pass: boolean; citation_correct: boolean; evidence_grounded: boolean; abstention_correct: boolean } {
  const abstentionCorrect = expectedSection === null
    ? answer.status === "insufficient_evidence" && answer.claims.length === 0 && answer.evidence.length === 0
    : answer.status === "review_required";
  const expected = expectedSection ? fixtureCorpus.find((item) => item.section === expectedSection) : undefined;
  const citationCorrect = expectedSection === null || retrievalOnly
    ? answer.claims.length === 0
    : answer.claims.length > 0 && answer.claims.every((claim) => claim.evidence_ids.length > 0 && claim.evidence_ids.every((id) => answer.evidence.some((hit) => hit.evidence_id === id && hit.section === expectedSection && hit.source_sha256 === expected?.source_sha256)));
  const evidenceGrounded = answer.claims.every((claim) => claim.quotes.length === claim.evidence_ids.length && claim.quotes.every((quote, i) => answer.evidence.some((hit) => hit.evidence_id === claim.evidence_ids[i] && hit.text.includes(quote))));
  const expectedReason = expectedSection === null ? answer.reason === "no_current_verified_section" : !retrievalOnly || answer.reason === "retrieval_only";
  return { pass: abstentionCorrect && citationCorrect && evidenceGrounded && expectedReason, citation_correct: citationCorrect, evidence_grounded: evidenceGrounded, abstention_correct: abstentionCorrect };
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(p * sorted.length) - 1] * 100) / 100;
}

export async function runEval(inference: LegalInference, repeats = 1, inputPerMillion?: number, outputPerMillion?: number, selectedCaseIds?: readonly string[]) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error("LEGAL_BENCHMARK_REPEATS must be 1..10");
  if (selectedCaseIds && (!selectedCaseIds.length || selectedCaseIds.some((id) => !cases.some((test) => test.id === id)))) {
    throw new Error("Unknown or empty benchmark case selection");
  }
  const selectedCases = selectedCaseIds ? cases.filter((test) => selectedCaseIds.includes(test.id)) : cases;
  const retrievalOnly = inference.id === "retrieval-only";
  const service = new LegalService(inference);
  const results = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const test of selectedCases) {
      const start = performance.now();
      const answer = await service.ask(test.question, asOf);
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      const assessment = assess(answer, test.section, retrievalOnly);
      const usage = answer.usage;
      const estimatedCostUsd = usage && inputPerMillion !== undefined && outputPerMillion !== undefined
        ? (usage.prompt_tokens * inputPerMillion + usage.completion_tokens * outputPerMillion) / 1_000_000 : null;
      results.push({ case: test.id, repeat, status: answer.status, reason: answer.reason ?? null, ...assessment,
        latency_ms: latencyMs, prompt_tokens: usage?.prompt_tokens ?? null, completion_tokens: usage?.completion_tokens ?? null,
        estimated_token_cost_usd: estimatedCostUsd });
    }
  }
  const latencies = results.map((item) => item.latency_ms);
  return { schema_version: 1, sample: true, corpus: "fictional-fixture", backend: inference.id, as_of: asOf, repeats,
    requests: results.length, passed: results.filter((item) => item.pass).length, failed: results.filter((item) => !item.pass).length,
    inference_errors: results.filter((item) => item.reason === "inference_unavailable").length,
    inference_timeouts: results.filter((item) => item.reason === "inference_timeout").length,
    p50_ms: percentile(latencies, 0.5), p95_ms: percentile(latencies, 0.95),
    estimated_token_cost_usd: !retrievalOnly && results.filter((item) => item.case === "current-10" || item.case === "near-miss-11").every((item) => item.estimated_token_cost_usd !== null)
      ? results.reduce((sum, item) => sum + (item.estimated_token_cost_usd ?? 0), 0) : null,
    cost_note: "Token-cost estimate requires provider usage and operator-supplied per-million-token rates; excludes infrastructure, idle time, taxes and other charges.",
    results };
}
