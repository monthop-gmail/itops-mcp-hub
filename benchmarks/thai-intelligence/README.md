# Thai Intelligence offline benchmark v0.1

This is a candidate evaluation pack, not a model leaderboard or production router. It uses fictional legal examples and synthetic SVG pages. No current Thai fact, statute, personal data, paid API, or model weights are bundled.

Run from the repository root:

```sh
npm run build -w @itops/mcp-rag
npm run build -w @itops/mcp-legal
node benchmarks/thai-intelligence/baseline.mjs
```

The JSON output pins the repository revision, fixture and asset SHA-256, Node version, baseline functions, per-case observations and explicit `not_tested` lanes. A passing case measures only its named baseline: it is **not** a model-quality score. The legal corpus is the repository's fictional fixture; a current result is **not** evidence that a real law is in force. The dated-fact rule abstains when no authority is supplied. OCR assets are SVG source pages; rasterize with a pinned renderer/version for any later OCR trial and record image hashes. They are intentionally not scored by this deterministic baseline.

For any later model run, score each lane separately: language/intent exact-match with human review for ambiguous code-switching; dated facts as supported answer, unsupported answer, or correct abstention against a dated source; OCR with character error rate plus field/table exact match; tools with exact allowed call/arguments and zero unauthorized side effects; legal with applicable-section precision/recall, date filtering and abstention; retrieval with Recall@k and MRR. Preserve raw outputs and the source spans behind every accepted factual claim. Do not merge publisher benchmark numbers with these independently reproduced results.

`model-registry.schema.json` records candidates, immutable revisions/checksums, role, modality, license/terms, deployment/data residency, compatibility, publisher-vs-reproduced evidence and approval state. `evidence-source-registry.schema.json` is separate: source authority, document/date/version/span/hash/rights. Never treat a model card or model output as an evidence source for factual claims.

Smallest next trial after reviewing baseline: run **one** approved local/hosted model against `tool-01`–`tool-04` and `fact-01`–`fact-02`, with side effects mocked and no restricted data. Pin model revision, tokenizer/chat template, prompt/decoding, request/response hashes, latency and any cost. Do not infer permission to use a paid endpoint from this plan. For legal trials, require source-verified section/date checks and owner approval separately; the OpenThai Legal Modal path is unresolved.
