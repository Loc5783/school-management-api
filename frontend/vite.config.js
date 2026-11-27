/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Mở host '0.0.0.0' để truy cập trực tiếp qua IP mạng LAN nội bộ (giống cấu hình JussStudio)
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:5001',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
