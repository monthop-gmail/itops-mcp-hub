#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  echo "✅ $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "❌ $1"
  if [ -n "${2:-}" ]; then
    echo "   $2"
  fi
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "command available: $1"
  else
    fail "missing required command: $1"
  fi
}

is_truthy_flag() {
  case "$1" in
    true|1|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

http_check() {
  local name="$1"
  local expected_code="$2"
  local body_must_contain="$3"
  shift 3

  local safe_name="${name//[^a-zA-Z0-9_-]/_}"
  local body_file="$TMP_DIR/${safe_name}.body"
  local header_file="$TMP_DIR/${safe_name}.headers"
  local stderr_file="$TMP_DIR/${safe_name}.stderr"
  local code

  code="$(curl -sS -o "$body_file" -D "$header_file" -w '%{http_code}' "$@" 2>"$stderr_file")" || code="000"
  if [ "$code" != "$expected_code" ]; then
    fail "$name returned HTTP $code (expected $expected_code)" "$(cat "$stderr_file" 2>/dev/null)"
    return
  fi

  if [ -n "$body_must_contain" ] && ! grep -Fq "$body_must_contain" "$body_file"; then
    fail "$name response body mismatch" "expected to contain: $body_must_contain"
    return
  fi

  pass "$name returned HTTP $expected_code"
}

echo "== ITOPS MCP HUB SMOKE TEST =="
echo "project: $ROOT_DIR"

require_command docker
require_command curl
require_command node

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo
  echo "Summary: $PASS_COUNT passed, $FAIL_COUNT failed"
  exit 1
fi

if [ ! -f .env ]; then
  fail ".env not found (copy from .env.example first)"
  echo
  echo "Summary: $PASS_COUNT passed, $FAIL_COUNT failed"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

missing_env=()
for key in IT_TOKEN ADMIN_TOKEN; do
  if [ -z "${!key:-}" ]; then
    missing_env+=("$key")
  fi
done

if [ "${#missing_env[@]}" -gt 0 ]; then
  fail "required env vars are empty" "$(printf '%s ' "${missing_env[@]}")"
  echo
  echo "Summary: $PASS_COUNT passed, $FAIL_COUNT failed"
  exit 1
fi

BASE_URL="${BASE_URL:-http://127.0.0.1:${MCP_LAN_PORT:-9080}}"
IT_URL="${BASE_URL%/}/mcp/it"
ADMIN_URL="${BASE_URL%/}/mcp/admin"
ALLOW_PUBLIC_IT_FLAG="$(printf '%s' "${ALLOW_PUBLIC_IT:-false}" | tr '[:upper:]' '[:lower:]')"
ALLOW_PUBLIC_ADMIN_FLAG="$(printf '%s' "${ALLOW_PUBLIC_ADMIN:-false}" | tr '[:upper:]' '[:lower:]')"

echo
echo "== Service checks =="
SERVICES_EXPECTED="$(docker compose config --services)"
SERVICES_RUNNING="$(docker compose ps --status running --services)"
NOT_RUNNING="$(comm -23 <(printf '%s\n' "$SERVICES_EXPECTED" | sort) <(printf '%s\n' "$SERVICES_RUNNING" | sort) || true)"

if [ -z "$NOT_RUNNING" ]; then
  pass "all compose services are running"
else
  fail "some compose services are not running" "$(echo "$NOT_RUNNING" | tr '\n' ' ')"
fi

HEALTH_ISSUES="$(
  docker compose ps --all --format json | node -e '
    const fs = require("node:fs");
    const input = fs.readFileSync(0, "utf8").trim();
    if (!input) process.exit(0);
    const lines = input.split(/\n+/).filter(Boolean);
    const issues = [];
    for (const line of lines) {
      const row = JSON.parse(line);
      if (row.State && row.State !== "running") {
        issues.push(`${row.Service}:state=${row.State}`);
      }
      if (row.Health && row.Health !== "healthy") {
        issues.push(`${row.Service}:health=${row.Health}`);
      }
    }
    if (issues.length > 0) {
      process.stdout.write(issues.join(", "));
      process.exit(1);
    }
  ' 2>/dev/null
)"
if [ $? -eq 0 ]; then
  pass "service states and healthchecks look good"
else
  fail "service state/health check failed" "$HEALTH_ISSUES"
fi

echo
echo "== Gateway and RBAC checks =="
http_check "gateway healthz" "200" "\"ok\":true" "${BASE_URL%/}/healthz"
http_check "IT -> /mcp/it/" "200" "" -H "Authorization: Bearer $IT_TOKEN" "${IT_URL}/"
http_check "ADMIN -> /mcp/admin/" "200" "" -H "Authorization: Bearer $ADMIN_TOKEN" "${ADMIN_URL}/"
if is_truthy_flag "$ALLOW_PUBLIC_ADMIN_FLAG"; then
  http_check "IT -> /mcp/admin/ (ALLOW_PUBLIC_ADMIN enabled)" "200" "" -H "Authorization: Bearer $IT_TOKEN" "${ADMIN_URL}/"
  http_check "no token -> /mcp/admin/ (ALLOW_PUBLIC_ADMIN enabled)" "200" "" "${ADMIN_URL}/"
else
  http_check "IT -> /mcp/admin/ (should be forbidden)" "403" "" -H "Authorization: Bearer $IT_TOKEN" "${ADMIN_URL}/"
  http_check "no token -> /mcp/admin/ (should be unauthorized)" "401" "" "${ADMIN_URL}/"
  http_check "query api_key -> /mcp/admin/ (disabled)" "401" "" "${ADMIN_URL}/?api_key=${ADMIN_TOKEN}"
fi
if is_truthy_flag "$ALLOW_PUBLIC_IT_FLAG"; then
  http_check "no token -> /mcp/it/ (ALLOW_PUBLIC_IT enabled)" "200" "" "${IT_URL}/"
else
  http_check "no token -> /mcp/it/ (should be unauthorized)" "401" "" "${IT_URL}/"
  http_check "query api_key -> /mcp/it/ (disabled)" "401" "" "${IT_URL}/?api_key=${IT_TOKEN}"
fi
http_check "IT healthz" "200" "\"service\":\"mcp-hub-it\"" -H "Authorization: Bearer $IT_TOKEN" "${IT_URL}/healthz"
http_check "ADMIN healthz" "200" "\"service\":\"mcp-hub-admin\"" -H "Authorization: Bearer $ADMIN_TOKEN" "${ADMIN_URL}/healthz"

echo
echo "== MCP initialize checks =="
INIT_BODY='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}}}'

http_check "IT initialize" "200" "\"name\":\"mcp-hub-it\"" \
  -H "Authorization: Bearer $IT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -X POST "${IT_URL}/mcp" \
  --data "$INIT_BODY"

http_check "ADMIN initialize" "200" "\"name\":\"mcp-hub-admin\"" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -X POST "${ADMIN_URL}/mcp" \
  --data "$INIT_BODY"

SSE_HEADERS="$TMP_DIR/it_sse.headers"
SSE_BODY="$TMP_DIR/it_sse.body"
curl -sS -N --max-time 5 \
  -D "$SSE_HEADERS" \
  -o "$SSE_BODY" \
  -H "Authorization: Bearer $IT_TOKEN" \
  -H "Accept: text/event-stream" \
  "${IT_URL}/sse" >/dev/null 2>&1 || true

SSE_CODE="$(awk 'NR==1 { print $2 }' "$SSE_HEADERS")"
if [ "$SSE_CODE" = "200" ] && grep -Fq "event: endpoint" "$SSE_BODY"; then
  pass "IT SSE endpoint opened successfully"
else
  fail "IT SSE endpoint check failed" "status=$SSE_CODE"
fi

echo
echo "== docker compose ps --all =="
docker compose ps --all

echo
echo "Summary: $PASS_COUNT passed, $FAIL_COUNT failed"
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
