import { RagCorpus } from "./corpus.js";
import { pageNeedsOcr } from "./extract.js";
import { fixtureIndexPath, writeFixtureCorpus } from "./fixture.js";
import { SYNTHETIC_OCR_PDF } from "./ocr.js";
import { parseOcrModelText, resolveTyphoonModel, runTyphoonOcr } from "./providers.js";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  assert(pageNeedsOcr("   \n\t  ", 40), "whitespace-only page should need OCR");
  assert(pageNeedsOcr("x".repeat(39), 40), "39 visible chars should need OCR at min 40");
  assert(!pageNeedsOcr("x".repeat(40), 40), "40 visible chars should not need OCR at min 40");
  assert(pageNeedsOcr("งบ\n\n  70", 40), "short Thai+digits page should need OCR");
  assert(resolveTyphoonModel("openai/typhoon-ocr") === "typhoon-ocr", "alias openai/typhoon-ocr");
  assert(resolveTyphoonModel("openai/typhoon-ocr-v1.5") === "typhoon-ocr", "alias v1.5");
  assert(resolveTyphoonModel("typhoon-ocr-preview") === "typhoon-ocr-preview", "legacy preview id");
  assert(
    parseOcrModelText('{"natural_text":"หัวตาราง 1"}') === "หัวตาราง 1",
    "unwrap Typhoon v1 natural_text JSON",
  );

  const mocked = await runTyphoonOcr(
    { mimeType: "image/jpeg", data: "ZmFrZQ==" },
    {
      TYPHOON_API_KEY: "sk-test",
      TYPHOON_API_BASE: "https://api.opentyphoon.ai/v1",
      TYPHOON_OCR_MODEL: "openai/typhoon-ocr-v1.5",
    },
    (async (url, init) => {
      if (String(url) !== "https://api.opentyphoon.ai/v1/chat/completions") {
        throw new Error(`unexpected typhoon url ${String(url)}`);
      }
      const body = JSON.parse(String(init?.body)) as { model?: string };
      if (body.model !== "typhoon-ocr") {
        throw new Error(`expected mapped model typhoon-ocr, got ${body.model}`);
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "MOCK-HTTP-OCR" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  );
  assert(mocked.text === "MOCK-HTTP-OCR" && mocked.model === "typhoon-ocr", "typhoon HTTP mock");

  const dir = writeFixtureCorpus();
  const corpus = new RagCorpus("fixture", dir, fixtureIndexPath(dir), true, "smoke", {
    includeImage: false,
    minChars: 40,
    ocrRender: async () => ({ mimeType: "image/jpeg", data: "ZmFrZQ==" }),
    ocrRun: async (input) => ({
      provider: input.provider || "typhoon",
      model: "typhoon-ocr",
      text: "ข้อความจากคนงานจำลอง\nMOCK-TYPHOON-TOKEN\nไม่ใช่เอกสารงบจริง",
    }),
  });
  corpus.open();
  const status = await corpus.reindex();
  if (!status.ready || status.file_count < 3 || status.sample !== true) {
    throw new Error(`fixture index incomplete: ${JSON.stringify(status)}`);
  }
  if (!status.ocr || status.ocr.pending < 2 || status.ocr.include_image !== false) {
    throw new Error(`expected fixture OCR queue: ${JSON.stringify(status.ocr)}`);
  }
  const hits = corpus.search("งบประมาณ 2570");
  if (hits.length < 1 || !hits[0]?.excerpt.includes("2570")) {
    throw new Error(`search missed budget text: ${JSON.stringify(hits)}`);
  }
  const latin = corpus.search("Zabbix");
  if (latin.length < 1) {
    throw new Error(`FTS5 missed latin token: ${JSON.stringify(latin)}`);
  }
  const shortThai = corpus.search("งบ");
  if (shortThai.length < 1) {
    throw new Error(`2-char LIKE fallback missed: ${JSON.stringify(shortThai)}`);
  }
  if (!status.index_engine?.includes("fts5")) {
    throw new Error(`expected fts5 engine in status: ${JSON.stringify(status)}`);
  }
  const sources = corpus.listSources(10, "งบประมาณ-2570");
  if (sources.length < 3) {
    throw new Error(`list_sources incomplete: ${JSON.stringify(sources)}`);
  }
  const chunk = corpus.getChunk(hits[0].chunk_id);
  if (!chunk?.text) {
    throw new Error("get_chunk failed");
  }

  const pending = corpus.listOcrQueue("pending");
  const job = pending.find((row) => row.path === SYNTHETIC_OCR_PDF && row.page === 1);
  if (!job) {
    throw new Error(`missing synthetic OCR job: ${JSON.stringify(pending)}`);
  }

  let submitBlocked = false;
  try {
    corpus.submitOcr(job.id, "should not land");
  } catch {
    submitBlocked = true;
  }
  if (!submitBlocked) {
    throw new Error("submit_ocr must refuse pending jobs");
  }

  const page = await corpus.getOcrPage(job.id);
  if (page.image_included || !page.image_omitted_reason) {
    throw new Error(`images must stay off by default: ${JSON.stringify(page)}`);
  }

  corpus.reviewOcrJob(job.id, "approve", "smoke");
  let runBlocked = false;
  try {
    await corpus.runOcr(pending.find((row) => row.page === 2)?.id ?? job.id + 1);
  } catch {
    runBlocked = true;
  }
  if (!runBlocked) {
    throw new Error("run_ocr must refuse pending jobs");
  }

  const token = "OCR-FIXTURE-TOKEN-ALPHA";
  const submitted = corpus.submitOcr(
    job.id,
    `ข้อความทดสอบคิว OCR fixture\n${token}\nไม่ใช่เอกสารงบจริง`,
  );
  if (submitted.job.status !== "done" || submitted.chunk_count < 1) {
    throw new Error(`submit did not index sidecar: ${JSON.stringify(submitted)}`);
  }
  const ocrHits = corpus.search(token);
  if (ocrHits.length < 1 || ocrHits[0]?.path !== SYNTHETIC_OCR_PDF) {
    throw new Error(`search missed OCR sidecar: ${JSON.stringify(ocrHits)}`);
  }

  const job2 = corpus.listOcrQueue("pending").find((row) => row.path === SYNTHETIC_OCR_PDF && row.page === 2);
  if (!job2) {
    throw new Error("missing page-2 OCR job for provider smoke");
  }
  corpus.reviewOcrJob(job2.id, "approve", "typhoon-mock");
  const ran = await corpus.runOcr(job2.id, { provider: "typhoon", save: true });
  if (!ran.saved || ran.provider !== "typhoon" || !ran.text.includes("MOCK-TYPHOON-TOKEN")) {
    throw new Error(`run_ocr save failed: ${JSON.stringify({ ...ran, text: ran.excerpt })}`);
  }
  if (corpus.search("MOCK-TYPHOON-TOKEN").length < 1) {
    throw new Error("run_ocr sidecar not searchable");
  }

  const after = await corpus.reindex();
  if (!after.ocr || after.ocr.done < 2) {
    throw new Error(`reindex must keep done OCR jobs: ${JSON.stringify(after.ocr)}`);
  }
  if (after.file_count < status.file_count) {
    throw new Error(`reindex dropped sources: ${after.file_count} vs ${status.file_count}`);
  }
  const leaked = corpus.listSources(200).some((row) => row.path.includes(".ocr.md") || row.path.startsWith("ocr/"));
  if (leaked) {
    throw new Error("OCR sidecar leaked into source list");
  }
  if (!corpus.listSources(200).some((row) => row.path === SYNTHETIC_OCR_PDF)) {
    throw new Error("submitted OCR PDF path missing from sources");
  }
  const still = corpus.search(token);
  if (still.length < 1) {
    throw new Error("reindex dropped sidecar text");
  }

  corpus.close();
  console.log("rag fixture smoke ok", status.file_count, hits.length, {
    ocr_pending: after.ocr?.pending,
    ocr_done: after.ocr?.done,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
