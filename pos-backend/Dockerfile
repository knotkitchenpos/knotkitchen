# =============================================================================
# Knot Kitchen POS backend
# =============================================================================
# Multi-stage build so the runtime image ships ONLY production dependencies
# and application code — no dev deps, no build tools, no cache. Uses the
# distroless-ish `node:20-alpine` because the app has no native compile step
# once bcrypt is prebuilt.

# ------------------------------- deps -----------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Copy manifests first so `npm ci` is cached until they change. bcrypt needs
# python + build-base to compile on Alpine; we install them ONLY in the deps
# stage so they never end up in the runtime image.
RUN apk add --no-cache python3 make g++ libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------- runtime --------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

# Run as an unprivileged UID. `node` (uid 1000) already exists in the base
# image, so we don't create a duplicate.
ENV NODE_ENV=production \
    PORT=8000

# tini gives us proper PID-1 signal handling — combined with the graceful
# shutdown handler in app.js, SIGTERM from `docker stop` results in a clean
# exit within Docker's default 30s stop window.
RUN apk add --no-cache tini curl

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# Volume mountpoints that the app writes to as `node` (uid 1000). Docker
# copies the ownership of these directories from the image the first time a
# fresh named volume attaches, so shipping them owned by node avoids the
# EACCES-on-first-write trap we hit with csd-documents in prod (Sep 2026).
RUN mkdir -p /app/uploads /app/csd-documents \
 && chown -R node:node /app/uploads /app/csd-documents

USER node
EXPOSE 8000

# Container-level liveness. `docker inspect --format='{{json .State.Health}}'`
# will show the last few probe results.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "app.js"]
