# =============================================================================
# KKMDM server  →  mdm.${BASE_DOMAIN}
# =============================================================================
# The API behind CSD's KKMDM screens (CSD is the only admin UI; the standalone
# dashboard was removed on 2026-11-16). Tablets reach the same host for
# enrollment, sync, the WebSocket and APK downloads.

# ------------------------------- server deps ---------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
# bcrypt compiles on Alpine; the toolchain stays in this stage only.
RUN apk add --no-cache python3 make g++ libc6-compat
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# -------------------------------- runtime ------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache tini libc6-compat
ENV NODE_ENV=production \
    PORT=8100 \
    KKMDM_STORAGE_DIR=/app/storage
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
# APK repository, agent APK, uploaded logs, generated secrets: the volume.
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8100/healthz >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
