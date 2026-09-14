# IT Operations Hub

เกตเวย์ MCP รวมศูนย์สำหรับงาน IT Operations บัญชี Express / Allinone / Odoo เข้า-ออกงาน ZKTime **pstack** และคลังเอกสารราชการ — เอเจนต์ AI คุยกับ **Zabbix 7**, **MeshCentral**, **Express** หรือ **Allinone** หรือ **Odoo**, **ZKTime 5**, **pstack**, และ **RAG** ผ่าน Streamable HTTP หลัง Cloudflare Tunnel และ Nginx RBAC

A production Docker Compose stack:

`Cloudflare Tunnel → Nginx (Bearer RBAC + OAuth DCR) → mcp-hub-it | mcp-hub-admin | mcp-hub-accounting → sub-mcp-zabbix | sub-mcp-meshcentral | sub-mcp-express | sub-mcp-allinone | sub-mcp-odoo | sub-mcp-zktime | sub-mcp-pstack | sub-mcp-rag`

All services share a single bridge network, `infra-net`. MCP hubs and databases are not published on the host. Only LAN/VPN ports for the gateway, Zabbix, and MeshCentral agents are bound.

## Architecture

```
AI agents (Claude Desktop, Cursor, ChatGPT, Grok)
        |  HTTPS  (+ OAuth DCR token page, or Authorization: Bearer)
        v
Cloudflare Zero Trust  ──tunnel──► cloudflared
        |
        v
Nginx :80 (internal) / MCP_LAN_PORT on the host
  OAuth  /authorize /token /register /.well-known/*  → mcp-oauth (token-paste page)
  Bearer IT_TOKEN          → role it          → /mcp/it/*          (it + admin)
  Bearer ADMIN_TOKEN       → role admin       → /mcp/admin/*       (admin only)
  Bearer ACCOUNTING_TOKEN  → role accounting  → /mcp/accounting/*  (accounting only)
        |
        +--> mcp-hub-it:3000           Zabbix + MeshCentral inventory + ZKTime + pstack + RAG
        +--> mcp-hub-admin:3000        same + meshcentral_run_shell + RAG
        +--> mcp-hub-accounting:3000   Express / Allinone / Odoo อ่านอย่างเดียว + RAG
                    |
                    +--> sub-mcp-zabbix / sub-mcp-meshcentral
                    +--> sub-mcp-express   fixture | http adapter | DBF
                    +--> sub-mcp-allinone  fixture | Access .mdb | MySQL
                    +--> sub-mcp-odoo      fixture | JSON-RPC (local หรือ SaaS)
                    +--> sub-mcp-zktime    fixture | att2000.mdb | SQL Server
                    +--> sub-mcp-pstack    fixture | pstack POST /mcp
                    +--> sub-mcp-rag       โฟลเดอร์เอกสารไซต์ (งบ 2570 ฯลฯ)
                              |
                              +--> zabbix-web / zabbix-server / zabbix-db
                              +--> meshcentral
                              +--> Express DBF หรือ Allinone .mdb / MySQL หรือ Odoo /jsonrpc
                              +--> ZKTime att2000.mdb หรือ SQL Server
                              +--> pstack POST /mcp (อินสแตนซ์ภายนอก)
                              +--> /mnt/c/data/2570 (หรือ fixture)
```

### Tools

| Tool | IT hub | Admin hub | Accounting hub |
| --- | --- | --- | --- |
| `zabbix_get_active_problems(severity_min?)` | yes | yes | no |
| `zabbix_get_device_status(group_name?)` | yes | yes | no |
| `zabbix_get_metrics(host_name, item_keys)` | yes | yes | no |
| `meshcentral_get_inventory()` | yes | yes | no |
| `meshcentral_run_shell(node_id, command)` | no | yes | no |
| `zktime_*` | yes | yes | no |
| `pstack_*` | yes | yes | no |
| `express_*` | no | no | yes เมื่อ `ACCOUNTING_PRODUCT=express` |
| `allinone_*` | no | no | yes เมื่อ `ACCOUNTING_PRODUCT=allinone` |
| `odoo_*` | no | no | yes เมื่อ `ACCOUNTING_PRODUCT=odoo` |
| `rag_get_status()` | yes | yes | yes |
| `rag_list_sources(path_prefix?, limit?)` | yes | yes | yes |
| `rag_search(query, path_prefix?, limit?)` | yes | yes | yes |
| `rag_get_chunk(chunk_id)` | yes | yes | yes |
| `rag_reindex()` | yes | yes | yes |
| `rag_ocr_status()` / `rag_list_ocr_queue(...)` | yes | yes | yes |
| `rag_review_ocr_job(job_id, action)` | yes | yes | yes |
| `rag_get_ocr_page(job_id)` | yes | yes | yes |
| `rag_run_ocr(job_id, provider?, save?)` | yes | yes | yes |
| `rag_submit_ocr(job_id, text)` | yes | yes | yes |

Nginx rejects an IT token on `/mcp/admin/` and `/mcp/accounting/` with HTTP 403. An accounting token cannot call IT or admin paths. The IT hub process does not register the shell tool. Accounting tools are read-only by default; Express = [docs/EXPRESS.md](docs/EXPRESS.md), Allinone = [docs/ALLINONE.md](docs/ALLINONE.md), Odoo = [docs/ODOO.md](docs/ODOO.md) (write tools stay hidden until `ODOO_ALLOW_WRITE=true`). Attendance (ZKTime 5) is on the IT/admin hubs; see [docs/ZKTIME.md](docs/ZKTIME.md). pstack apps on the same hubs; see [docs/PSTACK.md](docs/PSTACK.md). Document RAG does not require a fourth connector URL; scanned pages go through an OCR queue (approve before text/images leave the site). See [docs/RAG.md](docs/RAG.md).

## Requirements

- Docker Engine 24+ with Compose v2
- A host that can reach ESXi / switches / NVR / Windows agents on the LAN (Zabbix server port `10051`, MeshCentral `443`/`4433`)
- Optional: Cloudflare account for the public MCP hostname

## Quick start

```bash
git clone <this-repo>
cd itops-mcp-hub
cp .env.example .env
```

Edit `.env`:

1. Generate unique RBAC tokens (URL-safe, no spaces or quotes):

   ```bash
   openssl rand -hex 32   # IT_TOKEN
   openssl rand -hex 32   # ADMIN_TOKEN
   openssl rand -hex 32   # ACCOUNTING_TOKEN
   ```

2. Set `ZABBIX_DB_PASSWORD` and MeshCentral `MESHCENTRAL_PASSWORD` / `MESHCENTRAL_API_KEY`.
3. Leave `CLOUDFLARE_TUNNEL_TOKEN` empty until Zero Trust is configured.

Bring the stack up (LAN/VPN mode, no tunnel):

```bash
docker compose up -d
./scripts/smoke-test.sh
```

`smoke-test.sh` checks Compose health, Bearer-only RBAC, OAuth discovery, and MCP initialize on the LAN port. It does not print tokens.

First boot of Zabbix Postgres schema can take a couple of minutes. Watch:

```bash
docker compose ps
docker compose logs -f zabbix-server zabbix-web nginx mcp-hub-it
```

Gateway status page (LAN): `http://<compose-host>:9080/`

| Service | Default LAN port | Notes |
| --- | --- | --- |
| MCP + status page | `9080` | Nginx. MCP paths require a Bearer token |
| Zabbix UI | `9443` | First login `Admin` / `zabbix` — change immediately |
| Zabbix server | `10051` | Agents, ESXi, SNMP traps path into the server |
| MeshCentral HTTPS | `9444` | Create the first admin when `ALLOW_NEW_ACCOUNTS=true` |
| MeshCentral agent | `4433` | Agent/MPS |

### Cloudflare Tunnel (public MCP URL)

```bash
docker compose --profile tunnel up -d
```

`cloudflared` is distroless and expects a real `CLOUDFLARE_TUNNEL_TOKEN`. Do not start this profile until the token is set.

## First-run: Zabbix API token

The MCP Zabbix server authenticates with a Zabbix **API token** (Bearer), not the UI password.

1. Open `http://<host>:9443` and log in as `Admin`.
2. Change the Admin password; set `ZABBIX_WEB_PASSWORD` in `.env` to match.
3. User menu → **API tokens** → Create token `mcp-gateway`.
4. Put the secret into `ZABBIX_API_TOKEN` and recreate the Zabbix MCP container:

   ```bash
   docker compose up -d --force-recreate sub-mcp-zabbix
   ```

Alternatively, after the UI is up:

```bash
node scripts/create-zabbix-api-token.mjs
# paste the printed value into ZABBIX_API_TOKEN
```

Create host groups that match how you filter devices (`ESXi`, `Switches`, `CCTV`, `Windows servers`, …). `zabbix_get_device_status` searches group names.

## First-run: MeshCentral

1. Open `https://<host>:9444` (self-signed certificate on a fresh volume).
2. Create the account that matches `MESHCENTRAL_USER` / `MESHCENTRAL_PASSWORD`.
3. Set `MESHCENTRAL_ALLOW_NEW_ACCOUNTS=false` and recreate `meshcentral` after the first admin exists.
4. Install MeshAgents on Windows / Linux / ESXi management jump hosts as needed.
5. `meshcentral_get_inventory` reads the **cached** node list over `/control.ashx` (`action: "nodes"`). CPU/RAM are returned when MeshCentral already stored them on the node object; they are not probed live.
6. `meshcentral_run_shell` uses `runcommands` (PowerShell on Windows, POSIX shell otherwise) and is exposed only on the admin hub.

`MESHCENTRAL_API_KEY` is used as the control-channel password when `MESHCENTRAL_PASSWORD` is empty. Prefer a dedicated MeshCentral service user. Authentication is the MeshCentral `x-meshauth` header (`base64(user),base64(pass)`).

Internal TLS to `https://meshcentral:443` uses a self-signed cert. Keep `MESHCENTRAL_TLS_INSECURE=true` unless you mounted a real certificate into `meshcentral-data`.

## Cloudflare Zero Trust

This is the public path for AI clients. MeshCentral agents and Zabbix pollers stay on the LAN; only the MCP gateway is published.

### 1. Tunnel

1. Zero Trust → **Networks** → **Tunnels** → Create a locally managed tunnel, **or** fill `.env.xx` from `.env.xx.example` and run `./scripts/create-cloudflare-tunnel-token.sh` (writes the token into `.env.xx`, never prints it).
2. Copy `CLOUDFLARE_TUNNEL_TOKEN` into `.env`.
3. Public hostname, for example `mcp.example.com`:
   - Type: HTTP
   - URL: `http://nginx:80`
   - The connector runs **inside** `infra-net`, so it must use the Compose service name `nginx`, not a host port.
4. `docker compose --profile tunnel up -d`

Set `PUBLIC_MCP_ORIGIN=https://mcp.example.com` (the same public hostname) so ChatGPT/Grok OAuth discovery advertises the real URL. Then recreate `mcp-oauth` and `nginx`.

Optional origin settings in the hostname:

- HTTP Host Header: `mcp.example.com`
- Disable chunked encoding: **off** (SSE needs chunked transfer)
- No extra origin TLS (nginx listens HTTP on 80)

### 2. Access application (service tokens)

1. Zero Trust → **Access** → **Applications** → Add **Self-hosted**.
2. Application domain: `mcp.example.com` (include `/mcp*` if you split policies).
3. Identity: **Service Auth** (and optionally your IdP for humans).
4. Create a **Service Token** (`Client ID` + `Client Secret`).
5. Policy: Service Token is valid, then allow.

Cloudflare consumes the service token headers at the edge. Configure the application to **forward** these headers to origin (Access → Application → Settings / Overview, depending on the dashboard version):

| Header | Purpose |
| --- | --- |
| `CF-Access-Client-Id` | Service token id (validated by Cloudflare, then forwarded) |
| `CF-Access-Client-Secret` | Service token secret |
| `Authorization` | **Must pass through unmodified** — Nginx maps this to `it` / `admin` |
| `CF-Access-Jwt-Assertion` | Set by Cloudflare after a successful Access login |

If Access strips `Authorization`, Nginx will 401 every MCP call. Add `Authorization` to the allowed/forwarded header list, or put the MCP Bearer token in a second Access-approved header and change Nginx — this repo expects `Authorization: Bearer <IT_TOKEN|ADMIN_TOKEN|ACCOUNTING_TOKEN>`.

Create **two** Access service tokens if you want to rotate IT and Admin Cloudflare identities independently of the MCP RBAC tokens.

### 3. SSE through Cloudflare

Nginx already sets `proxy_buffering off`, `gzip off`, `X-Accel-Buffering: no`, and 1-hour proxy timeouts. In the tunnel hostname, do not enable extra buffering or “HTTP/2 to origin” if SSE stalls; HTTP/1.1 to nginx is the safe origin protocol.

## Team trial: ChatGPT / Grok (read-only)

ขณะรอ **ai-tools-mcp** (ชั้นอนุมัติคำสั่ง privileged) ทีมทดลองบน ChatGPT / Grok ได้ **เฉพาะเส้น IT**

- URL: `https://<tunnel-host>/mcp/it/mcp` — เลือก **OAuth** (อย่าเลือก Token ใน ChatGPT ถ้าต้องการหน้าเว็บ)
- ครั้งแรกเบราว์เซอร์เปิด `https://<tunnel-host>/authorize` ให้วาง `IT_TOKEN` เหมือน ai-collaboration-mcp
- ตั้ง `PUBLIC_MCP_ORIGIN=https://<tunnel-host>` ใน `.env` แล้ว recreate `mcp-oauth` + `nginx`
- ห้าม `ADMIN_TOKEN` และห้าม `/mcp/admin/` สำหรับทีมทดลอง
- ทีมบัญชีใช้เส้นแยก `https://<tunnel-host>/mcp/accounting/mcp` + `ACCOUNTING_TOKEN` + scope `mcp:accounting` — ดู [docs/EXPRESS.md](docs/EXPRESS.md)
- ขั้นตอนละเอียดอยู่ที่ [docs/TEAM-CONNECT.md](docs/TEAM-CONNECT.md)

`meshcentral_run_shell` ยังปิดสำหรับทีมทดลองจนกว่าจะมี payload-hash approval + human queue + audit

## MCP client configuration

Replace host, tokens, and Cloudflare service-token values. Claude Desktop still uses the legacy SSE transport (`/sse`). Newer clients can use Streamable HTTP (`/mcp`).

### Claude Desktop / SSE (IT role)

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "itops-it": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.example.com/mcp/it/sse",
        "--header",
        "Authorization: Bearer ${IT_TOKEN}",
        "--header",
        "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}",
        "--header",
        "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}"
      ]
    }
  }
}
```

If your client supports URL + headers natively:

```json
{
  "mcpServers": {
    "itops-it": {
      "url": "https://mcp.example.com/mcp/it/sse",
      "transport": "sse",
      "headers": {
        "Authorization": "Bearer IT_TOKEN_HERE",
        "CF-Access-Client-Id": "CLIENT_ID.access",
        "CF-Access-Client-Secret": "CLIENT_SECRET"
      }
    },
    "itops-admin": {
      "url": "https://mcp.example.com/mcp/admin/sse",
      "transport": "sse",
      "headers": {
        "Authorization": "Bearer ADMIN_TOKEN_HERE",
        "CF-Access-Client-Id": "CLIENT_ID.access",
        "CF-Access-Client-Secret": "CLIENT_SECRET"
      }
    }
  }
}
```

### Streamable HTTP

```json
{
  "mcpServers": {
    "itops-accounting": {
      "url": "https://mcp.example.com/mcp/accounting/mcp",
      "headers": {
        "Authorization": "Bearer ACCOUNTING_TOKEN_HERE"
      }
    }
  }
}
```

### LAN test without Cloudflare

```bash
curl -sS http://127.0.0.1:9080/healthz
curl -sS -D- -o /dev/null \
  -H "Authorization: Bearer $IT_TOKEN" \
  http://127.0.0.1:9080/mcp/it/
curl -sS -D- -o /dev/null \
  -H "Authorization: Bearer $IT_TOKEN" \
  http://127.0.0.1:9080/mcp/admin/
# expect 403 on the admin path
curl -sS -D- -o /dev/null \
  -H "Authorization: Bearer $IT_TOKEN" \
  http://127.0.0.1:9080/mcp/accounting/
# expect 403 — books are not an IT role
curl -sS -D- -o /dev/null \
  -H "Authorization: Bearer $ACCOUNTING_TOKEN" \
  http://127.0.0.1:9080/mcp/accounting/
```

## Repository layout

```
docker-compose.yml
nginx/                    # RBAC reverse proxy + status page
packages/
  Dockerfile              # shared Node 22 image, ARG SERVICE=
  mcp-common/             # Streamable HTTP + SSE helper
  mcp-zabbix/             # Zabbix JSON-RPC tools
  mcp-meshcentral/        # MeshCentral control.ashx tools
  mcp-express/            # Express Accounting (fixture / HTTP / DBF)
  mcp-allinone/           # Allinone CS/VM (fixture / Access / MySQL)
  mcp-odoo/               # Odoo JSON-RPC (fixture / local / SaaS) — no Workers
  mcp-pstack/             # bridge to pstack POST /mcp (no embedded platform)
  mcp-zktime/             # ZKTime 5 attendance (fixture / att2000.mdb / SQL Server)
  mcp-rag/                # local document RAG (budget / government files)
  mcp-hub/                # aggregator; HUB_ROLE=it|admin|accounting
  mcp-oauth/              # OAuth 2.1 + DCR; /authorize asks for site token
scripts/create-zabbix-api-token.mjs
scripts/smoke-test.sh
scripts/create-cloudflare-tunnel-token.sh
.env.xx.example           # Cloudflare API sidecar (copy to gitignored .env.xx)
docs/EXPRESS.md           # Express Accounting backends and RBAC
docs/ALLINONE.md          # Allinone CS (MySQL) / VM (Access)
docs/ODOO.md              # Odoo JSON-RPC for ICB / NST (not MTR)
docs/PSTACK.md            # pstack POST /mcp bridge (tools, not the inner agent)
docs/ZKTIME.md            # ZKTime 5 attendance (Access / SQL Server)
```

## Operations notes

- Rotate `IT_TOKEN` / `ADMIN_TOKEN` / `ACCOUNTING_TOKEN` by changing `.env` and `docker compose up -d --force-recreate nginx mcp-oauth`.
- Do not publish `mcp-hub-*`, `sub-mcp-*`, or `zabbix-db` to the internet.
- `meshcentral_run_shell` runs as SYSTEM/root (`runAsUser: 0`) on the agent. Treat `ADMIN_TOKEN` like production break-glass.
- After changing MeshCentral hostname or published HTTPS port, update `config.json` in the `meshcentral-data` volume (`aliasPort` / `cert`) so agent download URLs stay correct.
- Logs are JSON lines from the Node services and json-file rotated at 10 MB × 3.

### Nested Docker / CI hosts

If containers start but Nginx cannot reach `mcp-hub-*` (SSE hangs after a 200 auth, ping between containers fails), the kernel is filtering bridged traffic:

```bash
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0
sudo sysctl -w net.bridge.bridge-nf-call-ip6tables=0
```

This is a host setting, not a Compose service setting. Normal bare-metal or VM Docker installs already have working inter-container connectivity.

## License

Internal operations tooling. Review Zabbix and MeshCentral licenses for the upstream images.
