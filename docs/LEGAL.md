# Legal Intelligence fixture POC

This is an opt-in, read-only demonstration. The four sections in `packages/mcp-legal/src/corpus.ts` are fictional and use `example.invalid` URLs. They are not legal authorities. The service does not load operational documents or change the existing `rag_*` corpus.

## Architecture

`sub-mcp-legal` runs as a separate MCP service with its own fixture corpus and in-memory search index. The IT, Admin, and Accounting hubs expose `legal_search` and `legal_ask` only when `LEGAL_ENABLED=true`. Their existing Nginx Bearer role paths and `rag_*` tools remain in place. With the flag off, `legal_*` is absent from each hub's `tools/list`.

`legal_search` returns source text, evidence ID, law and section, source URL, effective dates, retrieval date, version, SHA-256 and an effective-date status. `legal_ask` searches first. It excludes expired, future and unknown-effective-date sections from the model context. The default inference backend is `retrieval-only`: it returns evidence for a human to review and generates no claims. A local OpenAI-compatible model server can be selected for CPU experiments.

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

Allow the model server only on a local Docker-reachable interface. The adapter refuses arbitrary external hosts for this fixture POC. The model card lists Q4 weights at about 18 GB and roughly 24 GB RAM/VRAM for inference; CPU latency has to be measured on the candidate machine. Its model license is `nvidia-open-model-agreement`; check the model terms before distributing weights or images.

Example candidate setup after downloading and checksum-pinning the GGUF to a private local path (replace the path, thread count and model ID with the actual candidate values):

```bash
llama-server -m /path/to/openthai-legal-q4.gguf -c 4096 -t 8 -np 1 --host 0.0.0.0 --port 8080
LEGAL_INFERENCE_BACKEND=openai-compatible LEGAL_MODEL_URL=http://127.0.0.1:8080 LEGAL_MODEL_ID=openthai-legal-q4 npm run benchmark -w @itops/mcp-legal
```

Protect the listener from other network clients while benchmarking. The benchmark performs one warm-up and ten fixture questions through the same adapter/validator as `legal_ask`, prints p50/p95 and fails when an answer does not validate. For the container trial, use `LEGAL_MODEL_URL=http://host.docker.internal:8080` in `.env` and confirm firewall rules before starting it.

Record model revision/checksum, CPU model, available RAM, context size, thread count, cold-start time and model-process peak RSS alongside the benchmark JSON. Also call `legal_ask` with section 12 and 13 to verify abstention; these cases should not call inference. Do not infer CPU performance from the model's GPU benchmarks.

## Next gate

Before testing with real law, source an authorized, versioned corpus from authoritative publishers with law ID, section, source URL, amendment and effective dates. Check retrieval quality on close sections and changed law, reviewer workflow, role access, and resource limits. The current fixture must never be presented as current legal advice.
