FROM nginx:1.27-alpine

RUN apk add --no-cache gettext \
    && mkdir -p /var/cache/nginx /var/run /var/log/nginx \
    && chown -R nginx:nginx /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html

COPY nginx.conf.template /etc/nginx/nginx.conf.template
COPY mcp_proxy.conf /etc/nginx/mcp_proxy.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY html/ /usr/share/nginx/html/

RUN chmod +x /docker-entrypoint.sh

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
