# Selective deployment and Cloudflare Workers compatibility (study, 2026-10-02)

Scope: study only; no production routing, migration, or new cloud resources. `mcp-host` is first. Findings below are from this repo plus linked vendor documentation; compatibility ratings are architectural judgments, not a deployed Workers test.

## Inventory and current boundaries

| Capability | Current location / exposure | Runtime dependency | Selective-deploy implication |
| --- | --- | --- | --- |
| IT operations | `mcp-hub-it` proxies Zabbix, MeshCentral inventory, ZKTime, pstack and RAG | Internal HTTP MCP backends, LAN/vendor APIs | Keep existing Compose backends; expose only selected tools by role. |
| Admin operations | `mcp-hub-admin` adds Mesh shell; `host_*` only with `HOST_ENABLED=true`; GitHub ingest POC only with `RAG_GITHUB_INGEST_ENABLED=true` | Privileged site connections; mounted local FS for host | Do not move shell/host data authority to an edge Worker. |
| Accounting | `mcp-hub-accounting` selects Express/Allinone/Odoo via `ACCOUNTING_PRODUCT`; RAG and optional Legal | Site accounting APIs/files | A per-site accounting variant already exists; avoid deploying unrelated backends. |
| Document RAG | `sub-mcp-rag`, all hub roles | `better-sqlite3` FTS5 on persistent volume, `pdftotext`/`pdfinfo`/`pdftoppm` subprocesses, local document mount | Keep local for now; GitHub ingestion is a bounded public-repo POC, not a migration. |
| Host file read | `sub-mcp-host` behind admin flag; `host_get_status/list/stat/read/search` | Docker `:ro` mount, `realpath` jail, Unix permissions, local audit JSONL | Preserve on-prem semantics; no equivalent host mount in Workers. |
| Auth/edge | `nginx` RBAC and `mcp-oauth`; optional `cloudflared` profile | Compose network and tunnel | Changing edge needs separate auth/streaming proof, not a package copy. |

Evidence: `packages/mcp-hub/src/{index,tools}.ts`, `packages/mcp-host/src/{index,jail,store,audit}.ts`, `packages/mcp-rag/src/{corpus,extract}.ts`, `docker-compose.yml`, `docs/HOST.md`, `docs/RAG.md`.

Package-level inventory (the registration gates below are code gates; a running container alone does not expose a tool):

| Package | Hub role / gate | Principal dependency |
| --- | --- | --- |
| `mcp-common` | shared by all; no tools | Node HTTP/MCP utilities |
| `mcp-hub` | three role-specific instances (`HUB_ROLE`) | internal MCP backend URLs; currently IT/admin require Zabbix, MeshCentral, ZKTime, pstack, RAG, while accounting requires one selected accounting backend plus RAG |
| `mcp-zabbix` | IT/admin | Zabbix API/site network |
| `mcp-meshcentral` | IT/admin; shell registered admin only | MeshCentral API/site network |
| `mcp-zktime` | IT/admin | ZKTime site data/API |
| `mcp-pstack` | IT/admin | pstack API/config |
| `mcp-express` | accounting when `ACCOUNTING_PRODUCT=express` | Express data source |
| `mcp-allinone` | accounting when `ACCOUNTING_PRODUCT=allinone` | Allinone data source |
| `mcp-odoo` | accounting when `ACCOUNTING_PRODUCT=odoo`; write separately gated by `ODOO_ALLOW_WRITE` | Odoo API |
| `mcp-rag` | all three roles; GitHub import admin-only opt-in | mounted docs/SQLite/PDF utilities; public GitHub API only when import is explicitly called |
| `mcp-legal` | all three roles only with `LEGAL_ENABLED=true` | fixture or configured model provider |
| `mcp-host` | admin only with `HOST_ENABLED=true` | `:ro` mounted local FS or fixture; local audit path |
| `mcp-oauth` | shared edge OAuth/DCR | Nginx/public-origin configuration and bearer roles |

Dependency isolation: `mcp-host` itself can run in fixture mode without Zabbix/pstack/RAG, but the **current admin hub** still constructs those clients and Compose `depends_on` waits for them. Thus making just `sub-mcp-host` optional does not yet create a reduced admin deployment; a profile/overlay must update hub backend construction and dependencies together. `mcp-host` does not need RAG's SQLite or PDF utilities. Conversely, `sub-mcp-rag` needs neither a host mount nor MeshCentral but does need its own persisted index volume in files mode. Nginx bearer/OAuth RBAC remains the outer privileged boundary in every profile.

## Selective deployment options

| Option | What changes | Recommendation |
| --- | --- | --- |
| A. Compose profiles + per-role flags | Keep one codebase; make optional backend containers/profile and `depends_on` conditional via separately generated Compose overlays; retain disabled tools absent from `tools/list`. | First choice. Smallest reversible step is a separate `compose.host.yml` overlay for a fixture-only admin host path, then verify disabled/default topology unchanged. Do not remove a required backend from `depends_on` without updating hub startup wiring. |
| B. Site-specific build targets | Build only required workspace packages/services per site, sharing `mcp-common` and hub facade. | Later if image/build cost justifies it; avoid duplicating package source. |
| C. Workers edge facade → on-prem MCP | Worker only authenticates/routes to a fixed private VPC Service; Compose backends remain authority. | Possible research POC, but extra auth/streaming surface and beta VPC dependency. No production cutover yet. |
| D. Full Workers migration | Replace local FS, SQLite, subprocess OCR, and LAN dependencies with cloud APIs/services. | Reject for current scope; different product semantics and data boundary. |

## Workers compatibility matrix (current Cloudflare docs)

| Component / capability | Direct Worker | Evidence and change required |
| --- | --- | --- |
| MCP JSON/HTTP facade and `fetch` proxy | Conditional | Worker supports web `fetch`; existing `serveMcpHttp` uses Node server transport, so rehost transport and prove Streamable HTTP/SSE, cancellation, auth and timeouts. A fixed [Workers VPC Service](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/) can reach one private HTTP origin over Tunnel; beta status is a rollout risk. |
| `mcp-host` mounted read-only FS | No semantic parity | Workers [VFS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/) only exposes bundled read-only files and request-local `/tmp`; it cannot see Docker `:ro` host mounts. Its timestamps are epoch and permissions/ownership are unsupported, so `host_stat`, readable/uid status and jail/audit semantics diverge. Keep the on-prem service. |
| `mcp-host` hypothetical Google Drive adapter | New capability, not a port | Drive API `files.list/get/export` could implement selected list/read/search behavior with OAuth scopes, pagination, quotas and Drive permissions. It cannot truthfully promise local `realpath`, Unix uid/mode, symlink jail, mtime parity or local audit. Design a separate `drive_*` contract if ever approved; do not silently substitute it for `host_*`. |
| RAG SQLite index | Not drop-in | `better-sqlite3` is a native Node addon and current index is a persistent local file. [D1](https://developers.cloudflare.com/d1/worker-api/) is a separate binding/API; it supports [FTS5](https://developers.cloudflare.com/d1/sql-api/sql-statements/) but moving there is a schema/query/transaction and data-governance migration, not a package rebuild. |
| PDF/OCR pipeline | No direct port | `node:child_process` is a [non-functional Worker stub](https://developers.cloudflare.com/workers/runtime-apis/nodejs/); the current pipeline launches `pdftotext`, `pdfinfo`, `pdftoppm`. Keep a site-side worker or redesign extraction explicitly. |
| Fixture-only pure TS tools | Candidate | Small stateless parsing/validation can be evaluated on Workers with a recent compatibility date, but each package's Node/native imports need a bundle/runtime proof. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) include 128 MB per isolate and plan-dependent CPU/subrequest caps. |
| Site API backends (Zabbix, MeshCentral, accounting) | Conditional | Public API access or a fixed VPC Service may work for HTTP; auth, reachability, site policy and least-privilege must be proven. Do not bind an entire private network for a first POC. |

`node:fs` appearing on Workers' supported list does **not** mean host-disk access. This is the decisive `mcp-host` compatibility boundary.

## Recommended smallest reversible POC and gates

1. Stay in Compose. Add an optional fixture-only host deployment overlay/flag without changing default `docker compose config --services` behavior. Compare `tools/list` for IT/admin/accounting with flag off/on; only admin gains five `host_*` tools when enabled.
2. Run existing `@itops/mcp-host` smoke (path traversal/symlink/secrets/limits/audit), hub smoke, and a container test as non-root with `:ro` mount. Check read-only behavior and audit path survives restart.
3. If edge research is later approved, make a standalone Worker facade bound to **one** VPC Service and a synthetic MCP backend. Verify auth scopes, no response buffering, SSE/Streamable HTTP, cancellation, errors, latency and rollback to Tunnel→Nginx. No real host data in that trial.

Acceptance gate: default tools and routes unchanged; admin-only visibility enforced by server registration, not prose; host reads stay inside mounted allowlist; secret path denial and symlink escape tests pass; no real document transfer; clear disable/rollback path. Unknowns: beta VPC availability for the account/site, Worker streaming behavior with current SDK transport, accounting API reachability, and cost. These require separate approval and a live fixture test.
