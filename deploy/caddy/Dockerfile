# =============================================================================
# Caddy image — stock Alpine build.
# =============================================================================
# We use Let's Encrypt HTTP-01 for every cert (Hostinger DNS, no Cloudflare),
# so no DNS-plugin build is required. If you later switch to DNS-01 for a
# real wildcard cert, reintroduce the xcaddy build stage with the matching
# DNS provider plugin.

FROM caddy:2-alpine
