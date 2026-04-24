import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import prismDesign from '@prism-design/devtools'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss(), prismDesign()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
