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

Smallest next trial after reviewing baseline: run **one** approved local/hosted model against `tool-01`–`tool-04` and `fact-01`–`fact-02`, with side effects mocked and no restricted data. Pin model revision, tokenizer/chat template, prompt/decoding, request/response hashes, latency and any cost. Do not infer permission to use a paid endpoint from this plan. For legal trials, require source-verified section/date checks and owner approval separately; the OpenThai Legal Modal path is unresolved.
