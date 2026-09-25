import type { LegalGeneration, LegalHit, LegalInference } from "./types.js";

export class RetrievalOnly implements LegalInference {
  readonly id = "retrieval-only";
  async generate(): Promise<LegalGeneration> {
    return { claims: [] };
  }
}

// The model process is separately provisioned on a CPU host. This adapter sends
// only the small retrieved fixture context to an OpenAI-compatible local server.
export class OpenAiCompatibleLegal implements LegalInference {
  readonly id: string;
  constructor(private readonly baseUrl: string, private readonly model: string, private readonly timeoutMs = 120000) {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "host.docker.internal"].includes(url.hostname)) {
      throw new Error("LEGAL_MODEL_URL must be a local HTTP endpoint for the fixture POC");
    }
    this.id = `openai-compatible:${model}`;
  }

  async generate(question: string, evidence: LegalHit[]): Promise<LegalGeneration> {
    const response = await fetch(new URL("/v1/chat/completions", this.baseUrl), {
      method: "POST",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model, temperature: 0, max_tokens: 512,
        messages: [
          { role: "system", content: "Return JSON only: {\"claims\":[{\"text\":string,\"evidence_ids\":[string],\"quotes\":[string]}]}. Cite only supplied evidence IDs. Each quote must be an exact substring of its cited evidence. If insufficient, return {\"claims\":[]}. The corpus is fictional fixture data." },
          { role: "user", content: JSON.stringify({ question, evidence: evidence.map(({ evidence_id, law_name, section, text, version }) => ({ evidence_id, law_name, section, text, version })) }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`legal model HTTP ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("legal model returned no content");
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as LegalGeneration).claims)) {
      throw new Error("legal model returned invalid JSON contract");
    }
    return parsed as LegalGeneration;
  }
}

export function createInference(env: NodeJS.ProcessEnv = process.env): LegalInference {
  const backend = (env.LEGAL_INFERENCE_BACKEND ?? "retrieval-only").trim();
  if (backend === "retrieval-only") return new RetrievalOnly();
  if (backend === "openai-compatible") {
    if (!env.LEGAL_MODEL_URL || !env.LEGAL_MODEL_ID) throw new Error("LEGAL_MODEL_URL and LEGAL_MODEL_ID are required");
    return new OpenAiCompatibleLegal(env.LEGAL_MODEL_URL, env.LEGAL_MODEL_ID);
  }
  throw new Error(`Unsupported LEGAL_INFERENCE_BACKEND: ${backend}`);
}
