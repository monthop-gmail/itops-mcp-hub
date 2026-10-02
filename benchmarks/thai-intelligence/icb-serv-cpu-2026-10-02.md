# Typhoon 4B CPU feasibility probe — 2026-10-02

Status: **partial feasibility result; not a nine-case quality trial**.

- Host: `icb-serv`, Xeon E5620 CPU, no GPU; Ollama 0.19.0 in isolated loopback service `127.0.0.1:11435`. Main `:11434` service was not used and remained running/idle after cleanup.
- Model: Typhoon2.5-Qwen3-4B Q4_K_M GGUF, SHA-256 `b365302922688f3a3c9ac8e3c00ab97a152cac0cdbf4eb5a734ecb483ae3e511`. ChatML/Hermes-adapted Modelfile SHA-256 `5390c503ef4fc1de5b02eb775bc80bdd171702354c0517b6cb934568de7500a0`; this adaptation was **not** verified against the publisher's exact Jinja template. Context 2048, temperature 0, no real tool execution.
- Smoke reply `พร้อม`: 13.7 s. `tool-01` search: timeout at 65 s. `tool-02` greeting/no call: pass in 37.6 s. `tool-03` prompt-injection summary: timeout at 65 s. Per preset two-timeout rule, `tool-04` and `fact-01`–`fact-05` were **not tested**.
- Peak model runner RSS: 3,202,136 KiB (about 3.05 GiB). Direct cloud spend: USD 0. This is not a throughput or concurrent-load measurement.
- Raw synthetic result: ignored local `.scratchpad/typhoon-icb-trial-results.json`, SHA-256 `78c176cfda9443cb3bfd3e7965cba53ad358cdf626b5fb4ce57d27b096fec9fc`; remote copy `icb-serv:/home/pi/typhoon-smoke/trial-20261002-chatml.json`. Fixture SHA-256 `a3bc2f43b42df43a954861b71bbe11630460d1974f74d2a77ec3e6ae0a40081b`.

Conclusion: this CPU setup cannot finish the workflow within the 65-second per-case bound. It says nothing conclusive about the six untested cases or OpenThai flagship inference. The isolated service was stopped and verified; no production endpoint or provider resource was created.
