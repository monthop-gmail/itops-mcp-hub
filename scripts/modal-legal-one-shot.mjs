// Fixture-only diagnostic. Requires a separately approved, already deployed Modal server.
import { mkdirSync, writeFileSync } from "node:fs";
import { OpenAiCompatibleLegal } from "../packages/mcp-legal/dist/inference.js";
import { runEval } from "../packages/mcp-legal/dist/eval.js";

const expectedModel = "iapp/openthai2.0-legal-thaillm-nemotron-3-nano-30b-a3b-NVFP4";
if (process.env.MODAL_LEGAL_OWNER_APPROVED !== "true" || process.env.LEGAL_BENCHMARK_ALLOW_REMOTE !== "true") {
  throw new Error("Separate owner approval and remote benchmark gate are both required");
}
const base = new URL(process.env.LEGAL_MODEL_URL ?? "");
if (base.protocol !== "https:" || ![".modal.direct", ".modal.run"].some((suffix) => base.hostname.endsWith(suffix)) ||
    base.username || base.password || base.search || base.hash) {
  throw new Error("LEGAL_MODEL_URL must be a credential-free Modal HTTPS URL");
}
const token = process.env.LEGAL_MODEL_API_KEY;
if (!token || !/^wk-[^.]+\.ws-.+$/.test(token)) throw new Error("A Modal proxy bearer token is required");
if (process.env.LEGAL_MODEL_ID !== expectedModel) throw new Error("Unexpected LEGAL_MODEL_ID");

const root = new URL(base);
root.pathname = root.pathname.replace(/\/v1\/?$/, "/");
const health = new URL("health", root);
const headers = { authorization: `Bearer ${token}` };
const started = performance.now();
const deadline = started + 900_000;
let attempts = 0;
let readyMs;

while (performance.now() < deadline) {
  attempts++;
  try {
    const response = await fetch(health, { headers, signal: AbortSignal.timeout(20_000) });
    if (response.status === 200) {
      readyMs = Math.round(performance.now() - started);
      break;
    }
    if (response.status !== 503) throw new Error(`Modal health HTTP ${response.status}`);
  } catch (error) {
    if (error.message?.startsWith("Modal health HTTP")) throw error;
    // Transport failures during cold start are recorded separately from inference.
    process.stderr.write(`health_transport=${error.name} cause=${error.cause?.code ?? "unknown"}\n`);
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (readyMs === undefined) throw new Error(`Modal health never became ready within 900s (${attempts} probes)`);

const adapter = new OpenAiCompatibleLegal(base.href, expectedModel, 600_000, token,
  { enableThinking: false, maxTokens: 2048 });
const inference = {
  id: adapter.id,
  async generate(...args) {
    try { return await adapter.generate(...args); }
    catch (error) {
      process.stderr.write(`inference_transport=${error.name} cause=${error.cause?.code ?? "unknown"} message=${error.message}\n`);
      throw error;
    }
  },
};

const first = await runEval(inference, 1, undefined, undefined, ["current-10"]);
const full = first.failed === 0 ? await runEval(inference, 1) : null;
const report = {
  schema_version: 1,
  provider: "modal",
  model: expectedModel,
  revision: "6e55ee86c91a863e984bc4697c34637ab6e64327",
  startup_ready_ms: readyMs,
  health_attempts: attempts,
  first,
  full,
  note: "Health readiness and first model request are measured separately. Provider billing must be checked independently.",
};
mkdirSync(new URL("../.scratchpad/", import.meta.url), { recursive: true });
const output = new URL(`../.scratchpad/modal-legal-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url);
writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ report: output.pathname, startup_ready_ms: readyMs,
  first_passed: first.passed, first_failed: first.failed,
  full_passed: full?.passed ?? null, full_failed: full?.failed ?? null }));
if (first.failed || full?.failed) process.exitCode = 1;
