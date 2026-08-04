import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// frontend lives in web/, backend (bun) is separate — proxy /api to it in dev
export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4950',
        ws: true,
      },
    },
  },
})
