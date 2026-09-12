# IT Operations Hub

เกตเวย์ MCP รวมศูนย์สำหรับงาน IT Operations — เอเจนต์ AI คุยกับ **Zabbix 7** (observability) และ **MeshCentral** (inventory / remote ops) ผ่าน SSE และ Streamable HTTP หลัง Cloudflare Tunnel และ Nginx RBAC

A production Docker Compose stack:

`Cloudflare Tunnel → Nginx (Bearer RBAC, SSE/WebSocket) → mcp-hub-it | mcp-hub-admin → sub-mcp-zabbix | sub-mcp-meshcentral → Zabbix / MeshCentral`

All services share a single bridge network, `infra-net`. MCP hubs and databases are not published on the host. Only LAN/VPN ports for the gateway, Zabbix, and MeshCentral agents are bound.

## Architecture

```
AI agents (Claude Desktop, Cursor, custom)
        |  HTTPS + CF-Access-Client-* + Authorization: Bearer
        v
Cloudflare Zero Trust  ──tunnel──► cloudflared
        |
        v
Nginx :80 (internal) / MCP_LAN_PORT on the host
  Bearer IT_TOKEN  → role it     → /mcp/it/*      (it + admin)
  Bearer ADMIN_TOKEN → role admin → /mcp/admin/*  (admin only)
        |
        +--> mcp-hub-it:3000      read-only tool set
        +--> mcp-hub-admin:3000   read-only + meshcentral_run_shell
                    |
                    +--> sub-mcp-zabbix       JSON-RPC 2.0
                    +--> sub-mcp-meshcentral  /control.ashx WebSocket
                              |
                              +--> zabbix-web / zabbix-server / zabbix-db
                              +--> meshcentral
```

### Tools

| Tool | IT hub | Admin hub |
| --- | --- | --- |
| `zabbix_get_active_problems(severity_min?)` | yes | yes |
| `zabbix_get_device_status(group_name?)` | yes | yes |
| `zabbix_get_metrics(host_name, item_keys)` | yes | yes |
| `meshcentral_get_inventory()` | yes | yes |
| `meshcentral_run_shell(node_id, command)` | no | yes |

Nginx rejects an IT token on `/mcp/admin/` with HTTP 403. The IT hub process does not register the shell tool.

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
   ```

2. Set `ZABBIX_DB_PASSWORD` and MeshCentral `MESHCENTRAL_PASSWORD` / `MESHCENTRAL_API_KEY`.
3. Leave `CLOUDFLARE_TUNNEL_TOKEN` empty until Zero Trust is configured.

Bring the stack up (LAN/VPN mode, no tunnel):

```bash
docker compose up -d
```

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

1. Zero Trust → **Networks** → **Tunnels** → Create a locally managed tunnel.
2. Copy the token into `CLOUDFLARE_TUNNEL_TOKEN`.
3. Public hostname, for example `mcp.example.com`:
   - Type: HTTP
   - URL: `http://nginx:80`
   - The connector runs **inside** `infra-net`, so it must use the Compose service name `nginx`, not a host port.
4. `docker compose --profile tunnel up -d`

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

If Access strips `Authorization`, Nginx will 401 every MCP call. Add `Authorization` to the allowed/forwarded header list, or put the MCP Bearer token in a second Access-approved header and change Nginx — this repo expects `Authorization: Bearer <IT_TOKEN|ADMIN_TOKEN>`.

Create **two** Access service tokens if you want to rotate IT and Admin Cloudflare identities independently of the MCP RBAC tokens.

### 3. SSE through Cloudflare

Nginx already sets `proxy_buffering off`, `gzip off`, `X-Accel-Buffering: no`, and 1-hour proxy timeouts. In the tunnel hostname, do not enable extra buffering or “HTTP/2 to origin” if SSE stalls; HTTP/1.1 to nginx is the safe origin protocol.

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
    "itops-admin": {
      "url": "https://mcp.example.com/mcp/admin/mcp",
      "headers": {
        "Authorization": "Bearer ADMIN_TOKEN_HERE",
        "CF-Access-Client-Id": "CLIENT_ID.access",
        "CF-Access-Client-Secret": "CLIENT_SECRET"
      }
    }
  }
}
```

### ChatGPT/Gemini connector fallback (OAuth-only UI)

Some hosted connector UIs may not let you set a static `Authorization` header and only expose OAuth setup. For local testing, this gateway also accepts a query token:

- Admin: `https://<public-host>/mcp/admin/mcp?api_key=<ADMIN_TOKEN>`
- IT: `https://<public-host>/mcp/it/mcp?api_key=<IT_TOKEN>`

Security notes:

- Query tokens can be exposed by browser history and intermediary logs; treat them as secrets.
- Rotate `IT_TOKEN` / `ADMIN_TOKEN` after testing.

If a connector still cannot finish OAuth and cannot send static headers, you can allow unauthenticated access only on IT routes:

```env
ALLOW_PUBLIC_IT=true
```

Then restart `nginx`:

```bash
docker compose up -d --build --force-recreate nginx
```

This keeps `/mcp/admin/*` protected while making `/mcp/it/*` reachable without tokens.

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
  mcp-hub/                # aggregator; HUB_ROLE=it|admin
scripts/create-zabbix-api-token.mjs
```

## Operations notes

- Rotate `IT_TOKEN` / `ADMIN_TOKEN` by changing `.env` and `docker compose up -d --force-recreate nginx`.
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
