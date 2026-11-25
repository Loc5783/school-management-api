# ==============================================================================
# Dockerfile Hợp Nhất (Full-Stack Production) — Frontend + Backend trong 1 Image
# Chỉ cần chạy duy nhất container này (+ MongoDB) là hoạt động cả Web UI & API!
# ==============================================================================

# --- Tầng 1: Build bản Production tĩnh cho Frontend (React 19 + Vite 8) ---
FROM node:22-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci

ARG VITE_API_URL=/api
ARG VITE_DEFAULT_SCHOOL_CODE=HOANANG-A
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_DEFAULT_SCHOOL_CODE=${VITE_DEFAULT_SCHOOL_CODE}

COPY frontend/ ./
RUN npm run build

# --- Tầng 2: Cài đặt thư viện Production cho Backend ---
FROM node:22-alpine AS backend-deps
WORKDIR /build/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- Tầng 3: Image vận hành Production duy nhất (Backend phục vụ luôn Frontend) ---
FROM node:22-alpine AS production
RUN apk add --no-cache tzdata
ENV TZ=Asia/Ho_Chi_Minh \
    NODE_ENV=production \
    PORT=5000 \
    HOST=0.0.0.0 \
    FRONTEND_DIST_PATH=/app/public

WORKDIR /app

COPY --from=backend-deps /build/backend/node_modules ./node_modules
COPY backend/package*.json backend/server.js backend/app.js ./
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/docker-entrypoint.sh ./docker-entrypoint.sh

# Nhúng toàn bộ bản build Production của Frontend vào /app/public để Express phục vụ trực tiếp
COPY --from=frontend-build /build/frontend/dist ./public

# Chuẩn hóa LF tránh lỗi CRLF từ Windows và cấp quyền thư mục uploads cho user non-root
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh \
    && chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /app/uploads/credentials \
    && chown -R node:node /app

USER node
EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]

