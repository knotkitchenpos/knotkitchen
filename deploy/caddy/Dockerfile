# =============================================================================
# Custom Caddy image with the Cloudflare DNS module baked in.
# =============================================================================
# We need the Cloudflare DNS-01 plugin to obtain a wildcard cert for
# *.knotkitchen.com. The upstream `caddy:2-alpine` image does not include it,
# so we compile a custom binary with `xcaddy`.

FROM caddy:2-builder-alpine AS builder
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
