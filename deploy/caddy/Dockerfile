# =============================================================================
# Caddy image — custom build with the Cloudflare DNS plugin.
# =============================================================================
# DNS is hosted on Cloudflare (DNS-only mode — no proxying, Caddy still
# terminates TLS directly). The api.{$BASE_DOMAIN} etc. certs still use plain
# HTTP-01 automatically; the Cloudflare plugin is only needed to obtain the
# *.{$BASE_DOMAIN} wildcard cert via DNS-01, since a wildcard can never be
# issued over HTTP-01.

FROM caddy:2-builder-alpine AS builder

RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
