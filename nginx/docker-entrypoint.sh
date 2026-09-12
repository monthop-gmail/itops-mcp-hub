#!/bin/sh
set -eu

if [ -z "${IT_TOKEN:-}" ] || [ -z "${ADMIN_TOKEN:-}" ] || [ -z "${ACCOUNTING_TOKEN:-}" ]; then
  echo "IT_TOKEN, ADMIN_TOKEN, and ACCOUNTING_TOKEN must be set" >&2
  exit 1
fi

if [ "$IT_TOKEN" = "$ADMIN_TOKEN" ] || [ "$IT_TOKEN" = "$ACCOUNTING_TOKEN" ] || [ "$ADMIN_TOKEN" = "$ACCOUNTING_TOKEN" ]; then
  echo "IT_TOKEN, ADMIN_TOKEN, and ACCOUNTING_TOKEN must all be different values" >&2
  exit 1
fi

if [ -z "${PUBLIC_MCP_ORIGIN:-}" ]; then
  if [ -n "${PUBLIC_MCP_HOSTNAME:-}" ]; then
    PUBLIC_MCP_ORIGIN="https://${PUBLIC_MCP_HOSTNAME}"
  else
    PUBLIC_MCP_ORIGIN="http://127.0.0.1:9080"
  fi
fi
PUBLIC_MCP_ORIGIN=${PUBLIC_MCP_ORIGIN%/}
export PUBLIC_MCP_ORIGIN

envsubst '${IT_TOKEN} ${ADMIN_TOKEN} ${ACCOUNTING_TOKEN} ${PUBLIC_MCP_ORIGIN}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/nginx.conf

nginx -t
exec nginx -g "daemon off;"
