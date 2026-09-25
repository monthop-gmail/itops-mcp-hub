import type { LegalGeneration, LegalHit, LegalInference } from "./types.js";

export class RetrievalOnly implements LegalInference {
  readonly id = "retrieval-only";
  async generate(): Promise<LegalGeneration> {
    return { claims: [] };
  }
}

// Sends only fictional, retrieved fixture context to a local or HTTPS endpoint.
export class OpenAiCompatibleLegal implements LegalInference {
  readonly id: string;
  private readonly chatUrl: URL;
  constructor(baseUrl: string, private readonly model: string, private readonly timeoutMs = 120000, private readonly apiKey = "") {
    const url = new URL(baseUrl);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "host.docker.internal"].includes(url.hostname))) ||
        url.username || url.password || url.search || url.hash) {
      throw new Error("LEGAL_MODEL_URL must be HTTPS or local HTTP, with no embedded credentials/query");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error("LEGAL_MODEL_TIMEOUT_MS must be 1000..600000");
    const path = url.pathname.replace(/\/$/, "");
    url.pathname = `${path.endsWith("/v1") ? path : `${path}/v1`}/chat/completions`;
    this.chatUrl = url;
    this.id = `openai-compatible:${model}`;
  }

  async generate(question: string, evidence: LegalHit[]): Promise<LegalGeneration> {
    const response = await fetch(this.chatUrl, {
      method: "POST",
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({
        model: this.model, temperature: 0, max_tokens: 512,
        messages: [
          { role: "system", content: "Return JSON only: {\"claims\":[{\"text\":string,\"evidence_ids\":[string],\"quotes\":[string]}]}. Cite only supplied evidence IDs. Each quote must be an exact substring of its cited evidence. If insufficient, return {\"claims\":[]}. The corpus is fictional fixture data." },
          { role: "user", content: JSON.stringify({ question, evidence: evidence.map(({ evidence_id, law_name, section, text, version }) => ({ evidence_id, law_name, section, text, version })) }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`legal model HTTP ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("legal model returned no content");
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as LegalGeneration).claims)) {
      throw new Error("legal model returned invalid JSON contract");
    }
    const usage = payload.usage;
    const validUsage = usage && [usage.prompt_tokens, usage.completion_tokens, usage.total_tokens].every((n) => Number.isSafeInteger(n) && Number(n) >= 0);
    return { claims: (parsed as LegalGeneration).claims, ...(validUsage ? { usage: usage as LegalGeneration["usage"] } : {}) };
  }
}

export function createInference(env: NodeJS.ProcessEnv = process.env): LegalInference {
  const backend = (env.LEGAL_INFERENCE_BACKEND ?? "retrieval-only").trim();
  if (backend === "retrieval-only") return new RetrievalOnly();
  if (backend === "openai-compatible") {
    if (!env.LEGAL_MODEL_URL || !env.LEGAL_MODEL_ID) throw new Error("LEGAL_MODEL_URL and LEGAL_MODEL_ID are required");
    return new OpenAiCompatibleLegal(env.LEGAL_MODEL_URL, env.LEGAL_MODEL_ID, Number(env.LEGAL_MODEL_TIMEOUT_MS ?? 120000), env.LEGAL_MODEL_API_KEY ?? "");
  }
  throw new Error(`Unsupported LEGAL_INFERENCE_BACKEND: ${backend}`);
}
