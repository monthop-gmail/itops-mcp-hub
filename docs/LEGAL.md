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

For a cloud trial, use an operator-provisioned OpenAI-compatible HTTPS endpoint that actually implements `POST /v1/chat/completions` and returns `choices[0].message.content` as contract JSON. Set `LEGAL_MODEL_URL` to its root or `/v1` base (a vendor-specific path prefix is preserved), `LEGAL_MODEL_ID`, and optionally `LEGAL_MODEL_API_KEY` and `LEGAL_MODEL_TIMEOUT_MS`. `LEGAL_MODEL_ENABLE_THINKING` (`true`/`false`) sends `chat_template_kwargs.enable_thinking` only when set; `LEGAL_MODEL_MAX_TOKENS` controls the response cap (default 512, maximum 8192). Put secrets only in ignored `.env` or a secret store, never in the URL or committed config. The adapter sends fictional fixture text only. An explicit `LEGAL_BENCHMARK_ALLOW_REMOTE=true` is required before the CLI sends remote requests. Example, after reviewing billing and providing your own endpoint:

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

For RunPod, its [vLLM Serverless OpenAI-compatible route](https://docs.runpod.io/serverless/vllm/openai-compatibility) is `https://api.runpod.ai/v2/ENDPOINT_ID/openai/v1`; this exact base works with `LEGAL_MODEL_URL`. A custom load-balancing endpoint or secured Pod can also work if it exposes the same contract. Do **not** paste a `/runsync` job URL into `LEGAL_MODEL_URL`: its request/response contract differs. Confirm the endpoint path and served model ID before increasing repeats. The same adapter can target Modal, Together or another provider when they expose the required HTTPS chat-completions contract; provider-specific APIs need a separate adapter. No cloud resource is created by this repo.

If the provider returns `usage.prompt_tokens` and `usage.completion_tokens`, optional `LEGAL_PRICE_INPUT_PER_1M_USD` and `LEGAL_PRICE_OUTPUT_PER_1M_USD` produce a token-cost estimate. It is `null` without rates or usage. This does not represent RunPod GPU/worker/idle billing or an invoice; record actual provider charges, GPU type, worker configuration, warm/cold state, model revision, region and date separately. Review [RunPod billing terms](https://docs.runpod.io/serverless/pricing) before enabling a trial. Do not provision paid resources without explicit approval.

### RunPod/OpenThai one-shot gate

This is a preparation checklist, **not** a deployment instruction. The owner later authorized a short USD 5–10 fixture-only trial and supplied a key through an ignored local `.env`; do not commit or disclose it. Never paste keys into chat, ai-collab, git, command arguments, or logs. Put `LEGAL_MODEL_API_KEY` only in an ignored local `.env` with restrictive file permissions or an approved secret store.

Candidate: RunPod's official vLLM Serverless worker with `MODEL_NAME=iapp/openthai2.0-legal-thaillm-nemotron-3-nano-30b-a3b`, `MODEL_REVISION=4fecc74ed016b1e35f1f17cf34a37968fa3c6179` (verify against the [Hugging Face history](https://huggingface.co/iapp/openthai2.0-legal-thaillm-nemotron-3-nano-30b-a3b/commits/main) before use), `TRUST_REMOTE_CODE=true`, `DTYPE=bfloat16`, `MAX_MODEL_LEN=32768`, `TENSOR_PARALLEL_SIZE=1`, and `GPU_MEMORY_UTILIZATION=0.90`. The publisher reports testing vLLM 0.19.1 on a single H100 80 GB with these settings; confirm the RunPod worker image supports this model and version before deployment. Pin/review executable model code because `TRUST_REMOTE_CODE` is enabled. Use H100 80 GB, one Flex worker maximum, zero always-active workers, no network volume, and the shortest supported idle timeout. The source model is roughly 63 GB on disk, so confirm sufficient container disk; avoid persistent storage unless explicitly priced. Do not substitute a GGUF checkpoint into this BF16/vLLM configuration.

The [RunPod price page](https://www.runpod.io/pricing) listed H100 Serverless at USD 4.79/hour on 2026-09-26, before storage and any other charges. Billing starts when the worker starts and includes loading and idle time, not just inference. A 30-minute worker lifetime would be about USD 2.40 compute at that listed rate; this is a planning estimate, **not a hard spend cap**. RunPod's account `spendLimit` is per hour, not a total experiment budget; one Flex worker and a local timer also do not guarantee a cumulative ceiling if the client or watchdog fails. The original USD 5 gate was later superseded by the owner's short-run USD 5–10 authorization; verify the current budget, rate, account balance, and independent stop path before any new trial. Set `LEGAL_BENCHMARK_REPEATS=1` for just five fixture cases (only two call the model), `LEGAL_MODEL_TIMEOUT_MS` high enough for the expected cold start, and `LEGAL_BENCHMARK_ALLOW_REMOTE=true`. Run once, save the JSON locally, then stop/delete the endpoint immediately and compare the provider's actual billed spend to the authorized ceiling. Never run `npm run benchmark` against a billable endpoint repeatedly without checking the balance and worker state.

Before the one-shot call, set `LEGAL_MODEL_URL=https://api.runpod.ai/v2/ENDPOINT_ID/openai/v1`, `LEGAL_MODEL_ID` to the model name returned by `/models` (or the configured `OPENAI_SERVED_MODEL_NAME_OVERRIDE`), and `LEGAL_MODEL_API_KEY` from the approved secret mechanism. The benchmark reports citation/grounding/abstention, errors/timeouts and p50/p95. Record the model revision, worker image/version, GPU, endpoint settings, wall-clock worker lifetime and RunPod billing record separately. If the model fails to initialize or its output misses the JSON contract, stop the endpoint rather than retrying blindly.

Live fixture observation (2026-09-26): The full-precision H100 80 GB attempt returned no usable model answers in two calls. A later A40 48 GB run with the publisher's [NVFP4 checkpoint](https://huggingface.co/iapp/openthai2.0-legal-thaillm-nemotron-3-nano-30b-a3b-NVFP4) (revision `6e55ee86c91a863e984bc4697c34637ab6e64327`) did return text, but with thinking enabled its content was not contract JSON. With `LEGAL_MODEL_ENABLE_THINKING=false` and `LEGAL_MODEL_MAX_TOKENS=2048`, the near-miss section-11 case returned a valid, grounded `review_required` result (227 prompt / 146 completion tokens; 39.65 s warm call). The first model-required case still failed with a network `fetch failed` after about 301 s of cold start, so that last run passed 4/5 fixture cases; it is not a complete quality pass. The three no-current-evidence cases abstained before inference. `p95_ms` includes the failed cold call and should not be interpreted as successful-model latency. All experimental endpoints were deleted and verified absent. Provider billing can post later; use the account's finalized billing history rather than treating immediate balance deltas as an invoice. No real legal corpus or production deployment was used.

### Modal/OpenThai preflight (not deployed)

`scripts/modal-legal.py` prepares a separate [Modal Server](https://modal.com/docs/guide/servers) with vLLM 0.20.2 on L40S 48 GB and the exact NVFP4 revision above. It has one GPU container at most, zero minimum, a five-second scaledown window, a 900-second startup timeout and mandatory [Proxy Token](https://modal.com/docs/guide/webhook-proxy-auth) authentication. It deliberately does **not** bundle a Modal account or token. A separate CPU preload function downloads the pinned Hugging Face snapshot to the `itops-legal-fixture-nvfp4` Volume. The Volume remains billable after the Server stops; deleting it is a separate, destructive cleanup choice. At Modal's listed $0.09/GiB/month, a roughly 20-GiB retained model is around $1.80/month before other usage; storage deletion may still be reflected for up to four days. Thus a $2 workspace budget requires prompt cleanup and may leave little headroom if the Volume remains. Local syntax/build checks do not create any cloud resources. This configuration is untested on Modal; NVFP4 compatibility and cold-start reliability remain experimental. Review the pinned model's custom code and [license](https://huggingface.co/iapp/openthai2.0-legal-thaillm-nemotron-3-nano-30b-a3b-NVFP4) before deploying, because vLLM uses `--trust-remote-code`.

Owner-only account gate, before **any** `modal run`, `modal deploy`, weight download or GPU request:

1. Create/select a *dedicated* Modal Starter workspace and check its plan, billing eligibility and available credits in Usage & Billing. This host currently has no Modal CLI or local Modal profile, so no account state or credits have been verified. Starter advertises $30/month free compute, but do not assume credits apply to this workspace or to storage.
2. As Workspace Owner/Manager, set a **USD 2 workspace usage budget** (not merely a net spend limit) on the Usage & Billing page. Confirm the effective monthly usage ceiling is $2 before credits, current cycle usage is below it, and no unrelated workload shares this workspace. A budget is monthly, not a per-experiment reset. Modal's budget documentation calls the workspace budget the hard outer cap; confirm in the dashboard that the setting saved and is effective. If a $2 usage budget cannot be configured, stop and ask for a new budget decision.
3. Install the official Modal CLI locally, authenticate with `modal setup`, and create a scoped Proxy Token in the workspace; these account-preparation steps do not authorize model preload/deployment. Store the combined `wk-...ws-...` token in a separate ignored `.env.modal` with mode 600 or a secret store, never in git, chat, ai-collab, URLs or shell command arguments. Do not overwrite the existing RunPod key in `.env`. Use a dedicated Modal environment/workspace if available; Starter environment budgets are not available.

After that separate approval, the bounded runbook is: `modal run scripts/modal-legal.py::preload_model` (paid CPU/network/Volume), verify the snapshot/revision and budget usage, then `modal deploy scripts/modal-legal.py` (image build and deployed Server). The deployed Server URL is the `LEGAL_MODEL_URL` root; use the full Hugging Face repo name as `LEGAL_MODEL_ID`. Set `LEGAL_MODEL_API_KEY` to the combined Modal Proxy Token, `LEGAL_BENCHMARK_ALLOW_REMOTE=true` and `MODAL_LEGAL_OWNER_APPROVED=true` only for the approved run, loading `.env.modal` into the process environment without echoing its contents. After `npm run build -w @itops/mcp-legal`, `node scripts/modal-legal-one-shot.mjs` polls authenticated `/health` through initial 503 responses (up to 900 seconds), measures readiness, calls fictional `current-10` once and runs all five fictional fixtures only if that first case passes. It writes an ignored local result JSON and never prints the token. Health/readiness, first inference and subsequent warm calls are separate measurements; client/network failures and provider logs still need joint diagnosis. Modal Servers [return 503 while scaling from zero](https://modal.com/docs/guide/servers), so a direct first benchmark call without a readiness gate is not a valid cold-start test.

At the end of an approved trial, stop the named app `itops-legal-fixture-poc` in Modal's dashboard or with `modal app stop itops-legal-fixture-poc`, verify no GPU containers remain, then inspect Usage & Billing (`modal billing summary` / `modal billing report --for today --show-resources`). Confirm actual GPU, CPU/memory, storage and any other charges rather than using token estimates. If the owner also approves removal of the **dedicated** model cache, verify its exact name and use `modal volume delete itops-legal-fixture-nvfp4`; this irreversibly removes the weights and may not immediately end storage billing. Do not delete a shared Volume or assume stopping the app deletes it. No real law, production endpoint or write tool belongs in this trial. Sources: [Modal budgets](https://modal.com/docs/guide/budgets), [pricing](https://modal.com/pricing), [model-weight storage](https://modal.com/docs/guide/model-weights), [Volumes](https://modal.com/docs/guide/volumes), and [vLLM example](https://modal.com/docs/examples/vllm_inference).

## Next gate

Before testing with real law, source an authorized, versioned corpus from authoritative publishers with law ID, section, source URL, amendment and effective dates. Check retrieval quality on close sections and changed law, reviewer workflow, role access, and resource limits. The current fixture must never be presented as current legal advice.
