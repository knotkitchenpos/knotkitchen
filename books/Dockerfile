# =============================================================================
# KnotKitchen Books, web version (books.<BASE_DOMAIN>)
# =============================================================================
# Same app as the Android APK. Caddy sends books.<base>/api/books to the API,
# so the web build calls it on its own origin (VITE_API_BASE empty).
FROM node:24-alpine AS build
WORKDIR /app
ENV VITE_API_BASE=""
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm test && npm run build

FROM nginx:1.30-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
