# Thai Intelligence offline benchmark v0.2

This is a candidate evaluation pack, not a model leaderboard or production router. It uses fictional legal examples and synthetic SVG pages. No current Thai fact, statute, personal data, paid API, or model weights are bundled.

Run from the repository root:

```sh
npm run build -w @itops/mcp-rag
npm run build -w @itops/mcp-legal
node benchmarks/thai-intelligence/baseline.mjs
```

The JSON output pins the repository revision, fixture and asset SHA-256, Node version, baseline functions, per-case observations and explicit `not_tested` lanes. A passing case measures only its named baseline: it is **not** a model-quality score. The legal corpus is the repository's fictional fixture; a current result is **not** evidence that a real law is in force. Dated facts now include no-source abstention, a current answer, a superseded revision, and conflicting current sources. The fixture-local selection rule refuses missing/conflicting evidence; it is not a public-fact verification service.

OCR assets are SVG source pages and remain `not_tested`. `ocr-render.json` pins the intended renderer (`@resvg/resvg-js` 2.6.2), 800×1100 white PNG parameters, and the reference Thai font hash. That renderer is not installed in this baseline run, so no rendered PNG or hash is claimed. **An OCR/model trial is blocked until the exact renderer and font are available, both pages are rasterized, their PNG SHA-256 values replace the null fields, and the render is independently reproducible.** The package/version is verified against the [publisher's npm listing](https://www.npmjs.com/package/%40resvg/resvg-js), not an installed dependency here.

For any later model run, score each lane separately: language/intent exact-match with human review for ambiguous code-switching; dated facts as supported answer, unsupported answer, or correct abstention against a dated source; OCR with character error rate plus field/table exact match; tools with exact allowed call/arguments and zero unauthorized side effects; legal with applicable-section precision/recall, date filtering and abstention; retrieval with Recall@k and MRR. Preserve raw outputs and the source spans behind every accepted factual claim. Do not merge publisher benchmark numbers with these independently reproduced results.

`model-registry.schema.json` records candidates, immutable revisions/checksums, role, modality, license/terms, deployment/data residency, tokenizer **and chat-template hash**, decoding config hash, serving-stack version, publisher-vs-reproduced evidence and approval state. Null compatibility fields mean **not checked**, not compatible. `evidence-source-registry.schema.json` is separate: source authority, document ID plus canonical revision (independent of retrieval time and content hash), supersession links, date/span/hash/rights. Never treat a model card or model output as an evidence source for factual claims. Tool fixtures now include typed parameter schemas and exact expected arguments; no-call cases expect null arguments and no side effect.

## Nine-case model trial (no GPU required to prepare)

`trial.mjs` covers **all four** tool cases and **all five** dated-fact cases. It never executes a tool; the tool definitions are only sent to a model or replayed. It scores exact tool name/arguments, no-call safety, JSON answer and exact source IDs. For prompt-injection and approval cases, a structural no-call pass still carries `semantic_review_required: true`; a human must inspect the response for false claims or unsafe advice. The report includes every case, request/response SHA-256, raw response, latency, usage if provided, and explicit `not_tested` rows after the two-timeout stop rule. `complete` means every case returned without transport error or timeout; it is **not** a quality pass. Any failed case makes the command exit nonzero.

Verify the harness offline, without a model, network or GPU:

```sh
node --test benchmarks/thai-intelligence/trial.test.mjs
node benchmarks/thai-intelligence/trial.mjs \
  --metadata benchmarks/thai-intelligence/replay-model.json \
  --replay benchmarks/thai-intelligence/replay-synthetic.json \
  --output .scratchpad/thai-replay-$(date +%s).json
```

The replay's nine passing answers are hand-authored **synthetic harness checks**, not model-quality evidence. Reports go to the ignored, persistent `.scratchpad/` folder by default in these examples. The script creates the output with mode 600 and refuses to overwrite an existing report.

A later approved model trial uses one OpenAI-compatible `/v1/chat/completions` endpoint and a metadata JSON containing `model`, immutable `model_revision`, `tokenizer_revision`, `artifact_sha256`, `chat_template_sha256`, `serving_stack`, and `decoding` (`temperature`, `max_tokens`). For a local-only server:

```sh
node benchmarks/thai-intelligence/trial.mjs \
  --metadata /path/to/pinned-model-metadata.json \
  --endpoint http://127.0.0.1:PORT/v1/chat/completions \
  --output .scratchpad/thai-model-$(date +%s).json
```

No local inference command is run by this repository. For an external HTTPS endpoint, an owner must separately approve the provider, data handling, license, spending cap, and exact model; only then set `MODEL_TRIAL_OWNER_APPROVED=true`. If authentication is needed, supply `MODEL_TRIAL_API_KEY` through a secret mechanism, never a URL, CLI argument, report, git or chat. The flag is a deliberate execution gate, **not** proof of account-level budget enforcement. Provider billing must be checked separately. Do not run paid endpoints just because this harness exists. Only synthetic fixture content is in requests; no real legal corpus, restricted data or production side effects belong in this trial.

The first `icb-serv` CPU feasibility attempt and its incomplete coverage are recorded in [icb-serv-cpu-2026-10-02.md](./icb-serv-cpu-2026-10-02.md). It does not establish model quality. A GPU-backed or substantially smaller-model run remains the next inference gate; the OpenThai Legal Modal path is a different candidate and is unresolved.
