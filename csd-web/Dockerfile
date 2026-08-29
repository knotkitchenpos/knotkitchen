# =============================================================================
# Knot Kitchen — Customer Support Desk SPA (csd.<BASE_DOMAIN>)
# =============================================================================
FROM node:20-alpine AS build
WORKDIR /app

# Baked into the bundle at build time. src/api/index.js appends "/csd", so this
# is the API root: https://api.<BASE_DOMAIN>/api  ->  .../api/csd
#
# It is a full origin rather than a relative "/api" because the SPA and the API
# are served from different hosts. That makes the calls cross-origin, which the
# platform already does for the POS: the API sets SameSite=None cookies in
# production and csd.<BASE_DOMAIN> is already in the CORS allowlist.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
