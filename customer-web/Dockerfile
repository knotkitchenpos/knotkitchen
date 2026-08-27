# =============================================================================
# Knot Kitchen — Customer Website
# =============================================================================
# Builds the Vite bundle in a Node stage and serves the static assets from
# nginx-alpine. There is ONE image, not one per store — the store is resolved
# at runtime from the request hostname (§8 of the spec).

# --------------------------------- build --------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# The Vite build inlines VITE_* env vars into the bundle at build time, so the
# operator must set them via `docker compose build --build-arg VITE_...=...`
# or by copying `deploy/.env` into the build context. Sensible defaults let
# `docker build` succeed without them.
ARG VITE_BACKEND_URL=""
ARG VITE_BASE_DOMAIN="knotkitchen.com"
ARG VITE_FALLBACK_SLUG=""
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL \
    VITE_BASE_DOMAIN=$VITE_BASE_DOMAIN \
    VITE_FALLBACK_SLUG=$VITE_FALLBACK_SLUG

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

# --------------------------------- runtime ------------------------------------
FROM nginx:1.27-alpine AS runtime

# The nginx config below serves the SPA and adds strict security headers.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# nginx is happy running as root inside a container (it drops to nginx-user
# for worker processes), but we still avoid publishing the container port
# directly — it's only reachable through Caddy on the internal network.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
