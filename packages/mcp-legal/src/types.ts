export interface LegalSource {
  id: string;
  law_id: string;
  law_name: string;
  section: string;
  text: string;
  source_url: string;
  effective_from: string | null;
  effective_to: string | null;
  retrieved_at: string;
  version: string;
  source_sha256: string;
}

export interface LegalHit extends LegalSource {
  evidence_id: string;
  score: number;
  effective_status: "current" | "expired" | "future" | "unknown";
}

export interface LegalClaim {
  text: string;
  evidence_ids: string[];
  quotes: string[];
}

export interface LegalGeneration {
  claims: LegalClaim[];
}

export interface LegalInference {
  readonly id: string;
  generate(question: string, evidence: LegalHit[]): Promise<LegalGeneration>;
}

export interface LegalAnswer {
  status: "review_required" | "insufficient_evidence";
  sample: true;
  backend: string;
  question: string;
  as_of: string;
  claims: LegalClaim[];
  evidence: LegalHit[];
  reason?: string;
}
