import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import { getKb } from './lib/api.js'
import { theme } from './config/theme.js'
import './styles/globals.css'

// ── Theme bridge ─────────────────────────────────────────────
// theme.js is the single source of truth. Push its values into
// CSS variables ONCE at boot; CSS only ever reads var(--x).
// Change a color/font in theme.js and everything updates.
const root = document.documentElement
root.style.setProperty('--bg-base', theme.colors.bgBase)
root.style.setProperty('--bg-header', theme.colors.bgHeader)
root.style.setProperty('--text', theme.colors.text)
root.style.setProperty('--text-muted', theme.colors.textMuted)
root.style.setProperty('--border', theme.colors.border)
root.style.setProperty('--glow-orange', theme.colors.glowOrange)
root.style.setProperty('--accent-blue', theme.colors.accentBlue)
root.style.setProperty('--font-mono', theme.fonts.mono)
root.style.setProperty('--font-body', theme.fonts.body)
root.style.setProperty('--title-glow', theme.header.glow)

const queryClient = new QueryClient()

// Warm the KB dashboard at boot (fresh for 60s) so the first drawer
// open is instant — the KB only refetches when a job finishes.
queryClient.prefetchQuery({ queryKey: ['kb'], queryFn: getKb, staleTime: 60_000 })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
