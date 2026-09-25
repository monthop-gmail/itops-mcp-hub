# Legal Intelligence fixture POC

This is an opt-in, read-only demonstration. The four sections in `packages/mcp-legal/src/corpus.ts` are fictional and use `example.invalid` URLs. They are not legal authorities. The service does not load operational documents or change the existing `rag_*` corpus.

## Architecture

`sub-mcp-legal` runs as a separate MCP service with its own fixture corpus and in-memory search index. The IT, Admin, and Accounting hubs expose `legal_search` and `legal_ask` only when `LEGAL_ENABLED=true`. Their existing Nginx Bearer role paths and `rag_*` tools remain in place. With the flag off, `legal_*` is absent from each hub's `tools/list`.

`legal_search` returns source text, evidence ID, law and section, source URL, effective dates, retrieval date, version, SHA-256 and an effective-date status. `legal_ask` searches first. It excludes expired, future and unknown-effective-date sections from the model context. The default inference backend is `retrieval-only`: it returns evidence for a human to review and generates no claims. An OpenAI-compatible local or HTTPS model endpoint can be selected for experiments.

The model contract contains claims, evidence IDs and exact quotes. The validator rejects unknown IDs, invented quotes and source-version/hash mismatches. A structurally valid draft still returns `review_required`: this validator cannot establish that a legal interpretation is correct. When evidence or inference is insufficient, `legal_ask` returns `insufficient_evidence` with no claims.

## Run fixture

```bash
npm ci
npm run build
npm run smoke -w @itops/mcp-legal
npm run smoke -w @itops/mcp-hub
```

For a local Compose trial, set `LEGAL_ENABLED=true` in `.env` and start the `legal-poc` profile:

```bash
docker compose --profile legal-poc up -d --build sub-mcp-legal mcp-hub-it mcp-hub-admin mcp-hub-accounting
./scripts/smoke-test.sh
```

Unset `LEGAL_ENABLED` or set it to `false`, recreate the three hubs, and `legal_*` disappears from all three tool lists. The Legal service is not started by the default Compose profile.

## Optional CPU model experiment

The adapter supports a locally hosted OpenAI-compatible `/v1/chat/completions` endpoint. It does not bundle or download model weights. For a candidate host with sufficient RAM and recent `llama.cpp`, use the official Q4 GGUF of [OpenThai 2.0 Legal](https://huggingface.co/iapp/openthai2.0-legal-thaillm-nemotron-3-nano-30b-a3b-GGUF), pin the exact revision and record its checksum. Start a local `llama-server` with a short context and one concurrent request, then set:

```dotenv
LEGAL_INFERENCE_BACKEND=openai-compatible
LEGAL_MODEL_URL=http://host.docker.internal:8080
LEGAL_MODEL_ID=openthai-legal-q4
```

Allow the model server only on a local Docker-reachable interface. Arbitrary external HTTP is refused; HTTPS is required for remote endpoints. The model card lists Q4 weights at about 18 GB and roughly 24 GB RAM/VRAM for inference; CPU latency has to be measured on the candidate machine. Its model license is `nvidia-open-model-agreement`; check the model terms before distributing weights or images.

Example candidate setup after downloading and checksum-pinning the GGUF to a private local path (replace the path, thread count and model ID with the actual candidate values):

```bash
llama-server -m /path/to/openthai-legal-q4.gguf -c 4096 -t 8 -np 1 --host 0.0.0.0 --port 8080
LEGAL_INFERENCE_BACKEND=openai-compatible LEGAL_MODEL_URL=http://127.0.0.1:8080 LEGAL_MODEL_ID=openthai-legal-q4 npm run benchmark -w @itops/mcp-legal
```

Protect the listener from other network clients while benchmarking. The benchmark runs five fixture cases through the same adapter/validator as `legal_ask`; set `LEGAL_BENCHMARK_REPEATS` (1–10) for more samples. It prints per-case outcomes, p50/p95, errors/timeouts and optional token-cost estimate, and exits nonzero on quality failures. For the container trial, use `LEGAL_MODEL_URL=http://host.docker.internal:8080` in `.env` and confirm firewall rules before starting it.

Record model revision/checksum, CPU model, available RAM, context size, thread count, cold-start time and model-process peak RSS alongside the benchmark JSON. Sections 12 and 13 test abstention and should not call inference. Do not infer CPU performance from the model's GPU benchmarks.

## Cloud inference benchmark (fixture only)

Run the no-cost retrieval baseline first:

```bash
npm run build -w @itops/mcp-legal
npm run benchmark -w @itops/mcp-legal
```

The harness uses five fixed cases: current sections 10 and 11 (including near-miss citation), expired section 12, unknown-effective-date section 13, and absent section 99. It checks status, exact fixture evidence ID/version and quote grounding, and that abstentions contain no claims. A valid generated claim still requires human review. `p50_ms` and `p95_ms` include local search and network time; sample size is reported. Errors/timeouts are counted separately. This is structural correctness only, not an assessment of legal accuracy.

For a cloud trial, use an operator-provisioned OpenAI-compatible HTTPS endpoint that actually implements `POST /v1/chat/completions` and returns `choices[0].message.content` as contract JSON. Set `LEGAL_MODEL_URL` to its root or `/v1` base (a vendor-specific path prefix is preserved), `LEGAL_MODEL_ID`, and optionally `LEGAL_MODEL_API_KEY` and `LEGAL_MODEL_TIMEOUT_MS`. Put secrets only in ignored `.env` or a secret store, never in the URL or committed config. The adapter sends fictional fixture text only. An explicit `LEGAL_BENCHMARK_ALLOW_REMOTE=true` is required before the CLI sends remote requests. Example, after reviewing billing and providing your own endpoint:

```dotenv
LEGAL_INFERENCE_BACKEND=openai-compatible
LEGAL_MODEL_URL=https://your-endpoint.example/v1
LEGAL_MODEL_ID=your-pinned-model-id
LEGAL_MODEL_API_KEY=your-private-token
LEGAL_MODEL_TIMEOUT_MS=120000
LEGAL_BENCHMARK_ALLOW_REMOTE=true
LEGAL_BENCHMARK_REPEATS=3
```

```bash
set -a; source .env; set +a
npm run benchmark -w @itops/mcp-legal
```

For RunPod, choose a [load-balancing HTTP endpoint](https://docs.runpod.io/serverless/overview) or a secured Pod exposing an OpenAI-compatible vLLM server. Do **not** paste a traditional `/runsync` job URL into `LEGAL_MODEL_URL`: its request/response contract differs. Confirm the exact endpoint path and model ID with a single fixture request before increasing repeats. The same adapter can target Modal, Together or another provider when they expose the required HTTPS chat-completions contract; provider-specific APIs need a separate adapter. No cloud resource is created by this repo.

If the provider returns `usage.prompt_tokens` and `usage.completion_tokens`, optional `LEGAL_PRICE_INPUT_PER_1M_USD` and `LEGAL_PRICE_OUTPUT_PER_1M_USD` produce a token-cost estimate. It is `null` without rates or usage. This does not represent RunPod GPU/worker/idle billing or an invoice; record actual provider charges, GPU type, worker configuration, warm/cold state, model revision, region and date separately. Review [RunPod billing terms](https://docs.runpod.io/serverless/pricing) before enabling a trial. Do not provision paid resources without explicit approval.

## Next gate

Before testing with real law, source an authorized, versioned corpus from authoritative publishers with law ID, section, source URL, amendment and effective dates. Check retrieval quality on close sections and changed law, reviewer workflow, role access, and resource limits. The current fixture must never be presented as current legal advice.
