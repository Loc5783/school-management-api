# ==============================================================================
# Dockerfile Backend — school-management-api (Node.js 22 LTS + Express 5 + Mongoose 9)
# ==============================================================================

FROM node:22-alpine AS base
RUN apk add --no-cache tzdata
ENV TZ=Asia/Ho_Chi_Minh
WORKDIR /app

# --- Tầng phát triển (Hot-reload với nodemon cho docker-compose.dev.yml) ---
FROM base AS dev
COPY package*.json ./
RUN npm ci
COPY . .
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh \
    && chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /app/uploads/credentials
EXPOSE 5000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "run", "dev"]

# --- Tầng cài đặt thư viện Production (tối ưu dung lượng image) ---
FROM base AS prod-deps
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- Tầng vận hành Production (chạy với tài khoản non-root an toàn) ---
FROM base AS production
ENV NODE_ENV=production \
    PORT=5000 \
    HOST=0.0.0.0

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package*.json server.js app.js ./
COPY src ./src
COPY scripts ./scripts
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Chuẩn hóa LF tránh lỗi CRLF khi build từ Windows và cấp quyền thư mục uploads cho user node
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

