#!/bin/sh
set -eu

if [ -z "${IT_TOKEN:-}" ] || [ -z "${ADMIN_TOKEN:-}" ]; then
  echo "IT_TOKEN and ADMIN_TOKEN must be set" >&2
  exit 1
fi

if [ "$IT_TOKEN" = "$ADMIN_TOKEN" ]; then
  echo "IT_TOKEN and ADMIN_TOKEN must be different values" >&2
  exit 1
fi

envsubst '${IT_TOKEN} ${ADMIN_TOKEN}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/nginx.conf

nginx -t
exec nginx -g "daemon off;"
