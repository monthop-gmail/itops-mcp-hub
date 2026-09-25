import { fixtureCorpus, isEffective, legalSearch, sourceHash, validDate } from "./corpus.js";
import type { LegalAnswer, LegalClaim, LegalGeneration, LegalHit, LegalInference, LegalSource } from "./types.js";

export function validateClaims(generated: LegalGeneration, evidence: readonly LegalHit[]): { ok: boolean; reason?: string; claims: LegalClaim[] } {
  if (!Array.isArray(generated.claims) || generated.claims.length === 0) {
    return { ok: false, reason: "no_supported_claims", claims: [] };
  }
  const byId = new Map(evidence.map((item) => [item.evidence_id, item]));
  for (const claim of generated.claims) {
    if (!claim || typeof claim.text !== "string" || !claim.text.trim() ||
        !Array.isArray(claim.evidence_ids) || claim.evidence_ids.length === 0 ||
        !Array.isArray(claim.quotes) || claim.quotes.length !== claim.evidence_ids.length) {
      return { ok: false, reason: "invalid_claim_contract", claims: [] };
    }
    for (let i = 0; i < claim.evidence_ids.length; i++) {
      const item = byId.get(claim.evidence_ids[i]);
      if (!item || typeof claim.quotes[i] !== "string" || !claim.quotes[i].trim() || !item.text.includes(claim.quotes[i])) {
        return { ok: false, reason: "unresolved_citation_or_quote", claims: [] };
      }
      const { evidence_id: _id, score: _score, effective_status: _status, source_sha256: _hash, ...source } = item;
      if (sourceHash(source) !== item.source_sha256 || item.evidence_id !== `${item.id}@${item.source_sha256}`) {
        return { ok: false, reason: "source_version_mismatch", claims: [] };
      }
    }
  }
  return { ok: true, claims: generated.claims };
}

export class LegalService {
  constructor(
    private readonly inference: LegalInference,
    private readonly corpus: readonly LegalSource[] = fixtureCorpus,
  ) {}

  search(query: string, asOf: string, limit = 5): { ok: true; sample: true; as_of: string; hits: LegalHit[]; count: number } {
    const hits = legalSearch(query, asOf, limit, this.corpus);
    return { ok: true, sample: true, as_of: asOf, count: hits.length, hits };
  }

  async ask(question: string, asOf: string): Promise<LegalAnswer> {
    if (!validDate(asOf)) throw new Error("as_of must be a valid YYYY-MM-DD date");
    const hits = legalSearch(question, asOf, 5, this.corpus);
    const valid = hits.filter((item) => isEffective(item, asOf));
    const base = { sample: true as const, backend: this.inference.id, question, as_of: asOf, evidence: valid };
    if (valid.length === 0) {
      return { ...base, status: "insufficient_evidence", claims: [], reason: "no_current_verified_section" };
    }
    if (this.inference.id === "retrieval-only") {
      return { ...base, status: "review_required", claims: [], reason: "retrieval_only" };
    }
    try {
      const generated = await this.inference.generate(question, valid);
      const checked = validateClaims(generated, valid);
      if (!checked.ok) {
        return { ...base, status: "insufficient_evidence", claims: [], reason: checked.reason, usage: generated.usage };
      }
      // Structural citation checks do not prove legal interpretation. A human reviews every claim.
      return { ...base, status: "review_required", claims: checked.claims, usage: generated.usage };
    } catch (error) {
      const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
      return { ...base, status: "insufficient_evidence", claims: [], reason: timeout ? "inference_timeout" : "inference_unavailable" };
    }
  }
}
