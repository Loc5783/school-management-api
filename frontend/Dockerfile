# ==============================================================================
# Dockerfile Frontend — React 19 + Vite 8 + Nginx Reverse Proxy
# ==============================================================================

FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

# --- Tầng phát triển (Vite HMR cho docker-compose.dev.yml) ---
FROM base AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# --- Tầng đóng gói tĩnh (Build bundle Production) ---
FROM base AS build
ARG VITE_API_URL=/api
ARG VITE_DEFAULT_SCHOOL_CODE=HOANANG-A
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_DEFAULT_SCHOOL_CODE=${VITE_DEFAULT_SCHOOL_CODE}
COPY . .
RUN npm run build

# --- Tầng vận hành Production (Nginx phục vụ SPA + Proxy /api sang Backend) ---
FROM nginx:1.27-alpine AS production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/nginx-health >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
