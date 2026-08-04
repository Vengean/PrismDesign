import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import prismDesign from 'vite-plugin-prism-design'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss(), prismDesign({ agentType: 'codex' })],
  server: {
    host: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
