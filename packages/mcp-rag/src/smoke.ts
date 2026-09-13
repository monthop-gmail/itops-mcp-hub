import { RagCorpus } from "./corpus.js";
import { writeFixtureCorpus } from "./fixture.js";
import { join } from "node:path";

async function main(): Promise<void> {
  const dir = writeFixtureCorpus();
  const corpus = new RagCorpus("fixture", dir, join(dir, "index.sqlite"), true, "smoke");
  corpus.open();
  const status = await corpus.reindex();
  if (!status.ready || status.file_count < 3 || status.sample !== true) {
    throw new Error(`fixture index incomplete: ${JSON.stringify(status)}`);
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
  corpus.close();
  console.log("rag fixture smoke ok", status.file_count, hits.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
