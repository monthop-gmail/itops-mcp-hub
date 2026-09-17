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
for key in IT_TOKEN ADMIN_TOKEN ACCOUNTING_TOKEN; do
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
ACCOUNTING_URL="${BASE_URL%/}/mcp/accounting"

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
http_check "oauth authorization server metadata" "200" "authorization_endpoint" "${BASE_URL%/}/.well-known/oauth-authorization-server"
http_check "oauth protected resource IT" "200" "\"resource\"" "${BASE_URL%/}/.well-known/oauth-protected-resource/mcp/it/mcp"
http_check "oauth protected resource accounting" "200" "mcp:accounting" "${BASE_URL%/}/.well-known/oauth-protected-resource/mcp/accounting/mcp"
http_check "oauth setup page" "200" "itops-public" "${BASE_URL%/}/oauth/setup"
http_check "IT -> /mcp/it/" "200" "" -H "Authorization: Bearer $IT_TOKEN" "${IT_URL}/"
http_check "ADMIN -> /mcp/admin/" "200" "" -H "Authorization: Bearer $ADMIN_TOKEN" "${ADMIN_URL}/"
http_check "ACCOUNTING -> /mcp/accounting/" "200" "" -H "Authorization: Bearer $ACCOUNTING_TOKEN" "${ACCOUNTING_URL}/"
http_check "IT -> /mcp/accounting/ (should be forbidden)" "403" "" -H "Authorization: Bearer $IT_TOKEN" "${ACCOUNTING_URL}/"
http_check "ACCOUNTING -> /mcp/it/ (should be forbidden)" "403" "" -H "Authorization: Bearer $ACCOUNTING_TOKEN" "${IT_URL}/"
http_check "no token -> /mcp/accounting/ (should be unauthorized)" "401" "" "${ACCOUNTING_URL}/"
http_check "IT -> /mcp/admin/ (should be forbidden)" "403" "" -H "Authorization: Bearer $IT_TOKEN" "${ADMIN_URL}/"
http_check "no token -> /mcp/admin/ (should be unauthorized)" "401" "" "${ADMIN_URL}/"
http_check "query api_key -> /mcp/admin/ (disabled)" "401" "" "${ADMIN_URL}/?api_key=${ADMIN_TOKEN}"
http_check "no token -> /mcp/it/ (should be unauthorized)" "401" "" "${IT_URL}/"
http_check "query api_key -> /mcp/it/ (disabled)" "401" "" "${IT_URL}/?api_key=${IT_TOKEN}"

UNAUTH_HEADERS="$TMP_DIR/it_mcp_unauth.headers"
curl -sS -o /dev/null -D "$UNAUTH_HEADERS" "${IT_URL}/mcp" || true
if grep -Fqi "resource_metadata" "$UNAUTH_HEADERS"; then
  pass "IT /mcp 401 includes WWW-Authenticate resource_metadata"
else
  fail "IT /mcp 401 missing WWW-Authenticate resource_metadata"
fi

http_check "IT healthz" "200" "\"service\":\"mcp-hub-it\"" -H "Authorization: Bearer $IT_TOKEN" "${IT_URL}/healthz"
http_check "ADMIN healthz" "200" "\"service\":\"mcp-hub-admin\"" -H "Authorization: Bearer $ADMIN_TOKEN" "${ADMIN_URL}/healthz"
http_check "ACCOUNTING healthz" "200" "\"service\":\"mcp-hub-accounting\"" -H "Authorization: Bearer $ACCOUNTING_TOKEN" "${ACCOUNTING_URL}/healthz"
ACCT_UNAUTH_HEADERS="$TMP_DIR/acct_mcp_unauth.headers"
curl -sS -o /dev/null -D "$ACCT_UNAUTH_HEADERS" "${ACCOUNTING_URL}/mcp" || true
if grep -Fqi "resource_metadata" "$ACCT_UNAUTH_HEADERS" && grep -Fq "mcp/accounting/mcp" "$ACCT_UNAUTH_HEADERS"; then
  pass "accounting /mcp 401 includes WWW-Authenticate resource_metadata"
else
  fail "accounting /mcp 401 missing WWW-Authenticate resource_metadata"
fi

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

http_check "ACCOUNTING initialize" "200" "\"name\":\"mcp-hub-accounting\"" \
  -H "Authorization: Bearer $ACCOUNTING_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -X POST "${ACCOUNTING_URL}/mcp" \
  --data "$INIT_BODY"

echo
echo "== Host tools stay off unless HOST_ENABLED =="

mcp_tool_names() {
  local token="$1"
  local url="$2"
  local headers="$TMP_DIR/mcp_tools.headers"
  local body="$TMP_DIR/mcp_tools.body"
  local sid
  curl -sS -o "$body" -D "$headers" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -X POST "${url}/mcp" \
    --data "$INIT_BODY" >/dev/null || true
  sid="$(awk -F': ' 'tolower($1)=="mcp-session-id" { gsub(/\r/,"",$2); print $2; exit }' "$headers")"
  if [ -z "$sid" ]; then
    echo ""
    return
  fi
  curl -sS \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "mcp-session-id: $sid" \
    -X POST "${url}/mcp" \
    --data '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
}

assert_no_host_tools() {
  local name="$1"
  local raw="$2"
  if printf '%s' "$raw" | grep -q 'host_'; then
    fail "$name tools/list must not include host_* while HOST_ENABLED is off"
  else
    pass "$name tools/list has no host_* (HOST_ENABLED default off)"
  fi
}

HOST_FLAG="$(printf '%s' "${HOST_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')"
if [ "$HOST_FLAG" = "true" ] || [ "$HOST_FLAG" = "1" ] || [ "$HOST_FLAG" = "yes" ]; then
  pass "HOST_ENABLED is on — skip default-off host_* assertion"
else
  assert_no_host_tools "IT" "$(mcp_tool_names "$IT_TOKEN" "$IT_URL")"
  assert_no_host_tools "ADMIN" "$(mcp_tool_names "$ADMIN_TOKEN" "$ADMIN_URL")"
  assert_no_host_tools "ACCOUNTING" "$(mcp_tool_names "$ACCOUNTING_TOKEN" "$ACCOUNTING_URL")"
fi

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
