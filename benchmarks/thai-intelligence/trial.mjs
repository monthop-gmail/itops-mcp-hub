#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTrial } from "./trial-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
}
if (args.includes("--help")) {
  process.stdout.write("Usage: node benchmarks/thai-intelligence/trial.mjs --metadata model.json --output report.json (--replay responses.json | --endpoint http://127.0.0.1:PORT/v1/chat/completions)\n");
  process.exit(0);
}
const metadataPath = arg("--metadata");
const outputPath = arg("--output");
const replayPath = arg("--replay");
const endpoint = arg("--endpoint");
if (!metadataPath || !outputPath || Boolean(replayPath) === Boolean(endpoint)) throw new Error("Provide --metadata, --output and exactly one of --replay or --endpoint; see --help");
const fixtureBytes = await readFile(join(here, "fixtures.json"));
const fixtures = JSON.parse(fixtureBytes.toString("utf8"));
const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
const model = metadata.model;
let invoke;
let transport;
if (replayPath) {
  const replay = JSON.parse(await readFile(replayPath, "utf8"));
  if (replay.schema_version !== "0.1") throw new Error("Unsupported replay version");
  transport = "offline_replay";
  invoke = async (_request, { caseId }) => {
    if (!(caseId in replay.responses)) throw new Error(`Missing replay case ${caseId}`);
    return replay.responses[caseId];
  };
} else {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash) throw new Error("Endpoint must not contain credentials, query or fragment");
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!loopback && (url.protocol !== "https:" || process.env.MODEL_TRIAL_OWNER_APPROVED !== "true")) throw new Error("Remote endpoint requires HTTPS and MODEL_TRIAL_OWNER_APPROVED=true");
  if (loopback && url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Endpoint must be HTTP(S)");
  transport = loopback ? "local_openai_compatible" : "approved_remote_openai_compatible";
  invoke = async (request, { timeoutMs }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { "content-type": "application/json" };
      if (process.env.MODEL_TRIAL_API_KEY) headers.authorization = `Bearer ${process.env.MODEL_TRIAL_API_KEY}`;
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(request), signal: controller.signal });
      if (!response.ok) throw new Error(`Model HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  };
}
const timeoutMs = Number(arg("--timeout-ms") ?? 65000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error("--timeout-ms must be 1000..300000");
const report = await runTrial({ fixtures, fixtureBytes, model, metadata, invoke, timeoutMs });
report.transport = transport;
report.cost_usd = transport === "offline_replay" || transport === "local_openai_compatible" ? 0 : null;
report.cost_note = transport === "approved_remote_openai_compatible" ? "Provider billing must be checked separately; token usage is not an invoice" : null;
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
process.stdout.write(`Wrote ${outputPath}: ${JSON.stringify(report.counts)}; complete=${report.complete}\n`);
if (!report.complete || report.counts.fail) process.exitCode = 1;
