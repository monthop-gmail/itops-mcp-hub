import { runEval } from "./eval.js";
import { createInference } from "./inference.js";

function optionalRate(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0) throw new Error("Benchmark token rates must be non-negative numbers");
  return rate;
}

const inference = createInference();
if (inference.id !== "retrieval-only" && new URL(process.env.LEGAL_MODEL_URL!).protocol === "https:" && process.env.LEGAL_BENCHMARK_ALLOW_REMOTE !== "true") {
  throw new Error("Set LEGAL_BENCHMARK_ALLOW_REMOTE=true to authorize billable remote calls");
}
const result = await runEval(inference, Number(process.env.LEGAL_BENCHMARK_REPEATS ?? 1),
  optionalRate(process.env.LEGAL_PRICE_INPUT_PER_1M_USD), optionalRate(process.env.LEGAL_PRICE_OUTPUT_PER_1M_USD));
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exitCode = 1;
