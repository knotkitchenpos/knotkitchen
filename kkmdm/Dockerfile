# =============================================================================
# KKMDM — server + admin dashboard in one image  →  mdm.${BASE_DOMAIN}
# =============================================================================
# The dashboard is built to static files and served by the server itself, so
# it shares the API's origin (cookie session, no CORS). Tablets reach the same
# host for enrollment, sync, the WebSocket and APK downloads.

# ---------------------------- dashboard build --------------------------------
FROM node:20-alpine AS dashboard
WORKDIR /dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci && npm cache clean --force
COPY dashboard/ ./
RUN npm run build

# ------------------------------- server deps ---------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
# bcrypt compiles on Alpine; the toolchain stays in this stage only.
RUN apk add --no-cache python3 make g++ libc6-compat
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# -------------------------------- runtime ------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache tini libc6-compat
ENV NODE_ENV=production \
    PORT=8100 \
    DASHBOARD_DIR=/app/dashboard \
    KKMDM_STORAGE_DIR=/app/storage
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY --from=dashboard /dashboard/dist ./dashboard
# APK repository, agent APK, uploaded logs, generated secrets: the volume.
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8100/healthz >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
