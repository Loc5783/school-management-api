/* global process */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Mở host '0.0.0.0' để truy cập trực tiếp qua IP mạng LAN nội bộ & tối ưu phân mảnh bundle Production
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
              priority: 20
            },
            {
              name: 'vendor-libs',
              test: /node_modules[\\/]/,
              priority: 10
            }
          ]
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: false,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:5001',
        changeOrigin: true,
        secure: false
      }
    }
  }
});
