#!/usr/bin/env bash
# Fetch (or create) a locally managed Cloudflare Tunnel and write
# CLOUDFLARE_TUNNEL_TOKEN into a sidecar env file. Does not print the token.
# Copy that value into .env before `docker compose --profile tunnel up -d`.
set -euo pipefail

ENV_FILE="${1:-.env.xx}"

if [ ! -f "$ENV_FILE" ]; then
  echo "env file not found: $ENV_FILE (copy .env.xx.example first)" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  echo "curl and node are required" >&2
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

tmp="$(mktemp)"
awk -v token="$tunnel_token" '
  BEGIN { done = 0 }
  /^CLOUDFLARE_TUNNEL_TOKEN=/ {
    print "CLOUDFLARE_TUNNEL_TOKEN=" token
    done = 1
    next
  }
  { print }
  END {
    if (!done) print "CLOUDFLARE_TUNNEL_TOKEN=" token
  }
' "$ENV_FILE" > "$tmp"
mv "$tmp" "$ENV_FILE"

echo "Tunnel name: ${TUNNEL_NAME}"
echo "Tunnel ID: ${tunnel_id}"
echo "CLOUDFLARE_TUNNEL_TOKEN has been written to ${ENV_FILE}"
echo "Copy that value into .env, then: docker compose --profile tunnel up -d"
