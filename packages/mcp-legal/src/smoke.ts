import { fixtureCorpus, legalSearch, sourceHash } from "./corpus.js";
import { OpenAiCompatibleLegal, RetrievalOnly } from "./inference.js";
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
  try { new OpenAiCompatibleLegal("https://external.example", "fixture"); } catch { rejected = true; }
  assert(rejected, "remote model endpoint rejected in fixture POC");
  const previousFetch = globalThis.fetch;
  let sentEvidence = false;
  globalThis.fetch = (async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    sentEvidence = request.messages[1].content.includes(section10[0].evidence_id);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ claims: [goodClaim] }) } }] }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const model = new OpenAiCompatibleLegal("http://127.0.0.1:8080", "fixture");
    const result = await model.generate("มาตรา 10", section10);
    assert(sentEvidence && result.claims[0].evidence_ids[0] === section10[0].evidence_id, "model adapter receives pinned evidence and parses JSON");
  } finally { globalThis.fetch = previousFetch; }
  console.log("legal fixture, citation, stale-date, fallback smoke ok");
}
main().catch((error) => { console.error(error); process.exit(1); });
