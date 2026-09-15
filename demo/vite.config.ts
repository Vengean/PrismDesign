import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import prismDesign from 'vite-plugin-prism-design'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    prismDesign({
      agentType: 'codex',
      httpProxy: 'http://127.0.0.1:7893',
      httpsProxy: 'http://127.0.0.1:7893',
      noProxy: '127.0.0.1,localhost',
      codexTransport: 'websocket',
      agentDebug: true,
      widget: false,
    }),
  ],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
