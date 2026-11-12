import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// Fixed port 5188 — the Memgraph UI owns 5178 and the original app owns 5173;
// this Relate UI must never collide with either. strictPort fails fast.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5188,
    strictPort: true,
  },
})
