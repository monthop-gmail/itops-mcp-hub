import { fixtureCorpus, legalSearch, sourceHash } from "./corpus.js";
import { OpenAiCompatibleLegal, RetrievalOnly } from "./inference.js";
import { assess, runEval } from "./eval.js";
import { LegalService, validateClaims } from "./service.js";
import type { LegalInference } from "./types.js";

function assert(cond: unknown, message: string): asserts cond { if (!cond) throw new Error(message); }

async function main(): Promise<void> {
  const date = "2026-09-25";
  const section10 = legalSearch("มาตรา 10", date);
  assert(section10.length === 1 && section10[0].section === "10", "exact section without near miss 11");
  assert(legalSearch("มาตรา 99", date).length === 0, "unknown section");
  const { source_sha256, ...source } = fixtureCorpus[0];
  assert(sourceHash(source) === source_sha256, "source hash resolves to pinned fixture version");
  const retrieval = new LegalService(new RetrievalOnly());
  const fallback = await retrieval.ask("มาตรา 10", date);
  assert(fallback.status === "review_required" && fallback.reason === "retrieval_only" && fallback.evidence.length === 1, "retrieval-only fallback");
  assert(legalSearch("มาตรา 12", date)[0].effective_status === "expired", "stale search status");
  assert((await retrieval.ask("มาตรา 12", date)).status === "insufficient_evidence", "stale section abstention");
  assert(legalSearch("มาตรา 13", date)[0].effective_status === "unknown", "unknown-date search status");
  assert((await retrieval.ask("มาตรา 13", date)).status === "insufficient_evidence", "unknown effective date abstention");
  const goodClaim = { text: "คำตอบตัวอย่าง", evidence_ids: [section10[0].evidence_id], quotes: [section10[0].text] };
  assert(validateClaims({ claims: [goodClaim] }, section10).ok, "resolvable citation and exact quote");
  assert(!validateClaims({ claims: [{ ...goodClaim, evidence_ids: ["fake"] }] }, section10).ok, "invented citation rejected");
  assert(!validateClaims({ claims: [{ ...goodClaim, quotes: ["ข้อความแต่ง"] }] }, section10).ok, "invented quote rejected");
  assert(!validateClaims({ claims: [goodClaim] }, [{ ...section10[0], version: "different" }]).ok, "version hash mismatch");
  const fakeModel: LegalInference = { id: "mock-model", async generate() { return { claims: [goodClaim] }; } };
  const draft = await new LegalService(fakeModel).ask("มาตรา 10", date);
  assert(draft.status === "review_required" && draft.claims.length === 1, "validated draft always needs review");
  const badModel: LegalInference = { id: "mock-bad", async generate() { return { claims: [{ ...goodClaim, evidence_ids: ["fake"] }] }; } };
  assert((await new LegalService(badModel).ask("มาตรา 10", date)).status === "insufficient_evidence", "invalid model claim abstains");
  let rejected = false;
  try { new OpenAiCompatibleLegal("http://external.example", "fixture"); } catch { rejected = true; }
  assert(rejected, "insecure remote model endpoint rejected");
  rejected = false;
  try { new OpenAiCompatibleLegal("https://user:secret@external.example", "fixture"); } catch { rejected = true; }
  assert(rejected, "embedded URL credentials rejected");
  const previousFetch = globalThis.fetch;
  let sentEvidence = false;
  let authenticated = false;
  let correctUrl = false;
  let generationOptions = false;
  globalThis.fetch = (async (input, init) => {
    const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }>; max_tokens: number; chat_template_kwargs?: { enable_thinking: boolean } };
    sentEvidence = request.messages[1].content.includes(section10[0].evidence_id);
    authenticated = new Headers(init?.headers).get("authorization") === "Bearer test-token";
    correctUrl = String(input) === "https://cloud.example/openai/v1/chat/completions";
    generationOptions = request.max_tokens === 2048 && request.chat_template_kwargs?.enable_thinking === false;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ claims: [goodClaim] }) } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const model = new OpenAiCompatibleLegal("https://cloud.example/openai/v1", "fixture", 120000, "test-token", { enableThinking: false, maxTokens: 2048 });
    const result = await model.generate("มาตรา 10", section10);
    assert(sentEvidence && authenticated && correctUrl && generationOptions && result.claims[0].evidence_ids[0] === section10[0].evidence_id && result.usage?.total_tokens === 120, "cloud adapter URL/auth/evidence/usage/options");
  } finally { globalThis.fetch = previousFetch; }
  const baseline = await runEval(new RetrievalOnly());
  assert(baseline.passed === 5 && baseline.failed === 0 && baseline.inference_errors === 0, "five-case retrieval baseline");
  const firstCase = await runEval(new RetrievalOnly(), 1, undefined, undefined, ["current-10"]);
  assert(firstCase.requests === 1 && firstCase.passed === 1 && firstCase.results[0].case === "current-10", "single-case paid gate selection");
  const mockEval = await runEval({ id: "mock-model", async generate(_question, evidence) {
    return { claims: [{ text: "fixture", evidence_ids: [evidence[0].evidence_id], quotes: [evidence[0].text] }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };
  } }, 2, 1, 2);
  assert(mockEval.passed === 10 && mockEval.failed === 0 && Math.abs((mockEval.estimated_token_cost_usd ?? 0) - 0.00056) < 1e-10, "repeatable mock eval and token cost");
  assert(!assess({ ...draft, claims: [{ ...goodClaim, evidence_ids: ["fake"] }] }, "10", false).citation_correct, "eval rejects false citation");
  const unavailable = await runEval({ id: "unavailable", async generate() { throw new Error("offline"); } });
  assert(unavailable.inference_errors === 2 && unavailable.failed === 2, "inference errors counted without network");
  console.log("legal fixture, citation, stale-date, fallback smoke ok");
}
main().catch((error) => { console.error(error); process.exit(1); });
