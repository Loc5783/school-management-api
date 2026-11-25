#!/bin/sh
set -e

mkdir -p /app/uploads/credentials

if [ "${RUN_DB_BOOTSTRAP:-true}" = "true" ]; then
  echo "🔄 [Entrypoint] Đang kiểm tra kết nối MongoDB, Multi-Tenant Indexes và dữ liệu khởi tạo..."
  node src/scripts/dockerBootstrapDb.js
fi

exec "$@"

