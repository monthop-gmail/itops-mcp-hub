#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env.xx}"

if [ ! -f "$ENV_FILE" ]; then
  echo "env file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${CF_API_TOKEN:?CF_API_TOKEN is required in $ENV_FILE}"
: "${CF_ACCOUNT_ID:?CF_ACCOUNT_ID is required in $ENV_FILE}"
TUNNEL_NAME="${CF_TUNNEL_NAME:-itops-mcp-hub}"
export TUNNEL_NAME

api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS --fail-with-body \
      -X "$method" \
      "https://api.cloudflare.com/client/v4${path}" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$body"
  else
    curl -sS --fail-with-body \
      -X "$method" \
      "https://api.cloudflare.com/client/v4${path}" \
      -H "Authorization: Bearer ${CF_API_TOKEN}"
  fi
}

read_json() {
  node -e "$1"
}

list_json="$(api GET "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel")"
tunnel_id="$(printf '%s' "$list_json" | read_json '
let s = "";
process.stdin.on("data", d => s += d).on("end", () => {
  const j = JSON.parse(s);
  if (!j.success) {
    console.error(JSON.stringify(j.errors || j));
    process.exit(2);
  }
  const arr = Array.isArray(j.result) ? j.result : [];
  const match = arr.find(t => t && t.name === process.env.TUNNEL_NAME && !t.deleted_at);
  process.stdout.write(match ? String(match.id || "") : "");
});
')"

if [ -z "$tunnel_id" ]; then
  create_json="$(api POST "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel" "{\"name\":\"${TUNNEL_NAME}\",\"config_src\":\"cloudflare\"}")"
  tunnel_id="$(printf '%s' "$create_json" | read_json '
let s = "";
process.stdin.on("data", d => s += d).on("end", () => {
  const j = JSON.parse(s);
  if (!j.success || !j.result || !j.result.id) {
    console.error(JSON.stringify(j.errors || j));
    process.exit(2);
  }
  process.stdout.write(String(j.result.id));
});
')"
fi

token_json="$(api GET "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${tunnel_id}/token")"
tunnel_token="$(printf '%s' "$token_json" | read_json '
let s = "";
process.stdin.on("data", d => s += d).on("end", () => {
  const j = JSON.parse(s);
  if (!j.success) {
    console.error(JSON.stringify(j.errors || j));
    process.exit(2);
  }
  const r = j.result;
  const token =
    typeof r === "string" ? r :
    (r && typeof r.token === "string" ? r.token : "");
  if (!token) {
    console.error("token not found in API response");
    process.exit(3);
  }
  process.stdout.write(token);
});
')"

if grep -q "^CLOUDFLARE_TUNNEL_TOKEN=" "$ENV_FILE"; then
  sed -i "s|^CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=${tunnel_token}|" "$ENV_FILE"
else
  printf '\nCLOUDFLARE_TUNNEL_TOKEN=%s\n' "$tunnel_token" >> "$ENV_FILE"
fi

echo "Tunnel name: ${TUNNEL_NAME}"
echo "Tunnel ID: ${tunnel_id}"
echo "CLOUDFLARE_TUNNEL_TOKEN has been written to ${ENV_FILE}"
