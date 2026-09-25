import { createInference } from "./inference.js";
import { LegalService } from "./service.js";

const inference = createInference();
if (inference.id === "retrieval-only") {
  throw new Error("Select LEGAL_INFERENCE_BACKEND=openai-compatible before benchmarking");
}
const service = new LegalService(inference);
const question = "มาตรา 10";
const asOf = "2026-09-25";
const durations: number[] = [];
let failed = 0;
for (let i = 0; i < 11; i++) {
  const start = performance.now();
  const answer = await service.ask(question, asOf);
  const ms = Math.round(performance.now() - start);
  if (i > 0) durations.push(ms);
  if (answer.status !== "review_required" || answer.claims.length === 0) failed++;
}
durations.sort((a, b) => a - b);
const percentile = (p: number): number => durations[Math.ceil(p * durations.length) - 1];
console.log(JSON.stringify({ backend: inference.id, sample: true, question, runs: durations.length,
  warmup_excluded: 1, p50_ms: percentile(0.5), p95_ms: percentile(0.95), failed, durations_ms: durations }));
if (failed) process.exitCode = 1;
