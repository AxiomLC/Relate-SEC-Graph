import { theme } from '../config/theme.js'
import { TOGGLE_TYPES, typeOn } from '../config/nodeTypes.js'

// 🎛 UTILITIES drawer — how to DISPLAY the graph (client-side render filters).
// Beta 2.1 (10 Aug 26): wired to the 3D map via nodeVisibility/linkVisibility
// (the map HIDES existing objects — no scene rebuild, no re-layout churn).
// Node-type toggles only: a node off hides its connected edges too.
// CONTRACT > / CONTRACT < (10 Aug 26): the contract's own band meta (">" juicy,
// "<" boring) decides which toggle applies — a contract shows when its band's
// toggle is on. TICKER is omitted (island rule — hiding a ticker cascades its
// whole cluster off the map).
// State lives in App (single source of truth — checkbox + map read the same
// object, so one click = one visible change).
// Beta 2.4 (16 Aug 26): the toggle list moved to config/nodeTypes.js — the
// SAME list + visibility predicates drive the drawer, the map crawl, AND the
// search layer's allowlist ("Utilities rules everything", Search Wiring.md §3).

export default function UtilitiesDrawer({ open, onClose, entityTypes, onEntityTypes }) {
  if (!open) return null

  // entityTypes: null = all on (default) · object = {KEY: true|false}.
  // `vis[t] !== false` → undefined (all-on) counts as VISIBLE — so the first
  // click flips to false (hidden) and unchecks in the SAME frame.
  const vis = entityTypes ?? {}

  const toggle = (t) => {
    const next = { ...vis, [t]: !(vis[t] !== false) }
    onEntityTypes(next)
  }

  const reset = () => onEntityTypes(null)

  return (
    <div
      style={{
        position: 'absolute',
        top: 46,
        right: 52,
        width: 280,
        maxHeight: 'calc(100vh - 90px)',
        overflowY: 'auto',
        zIndex: 20,
        background: theme.colors.bgHeader,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: 4,
        padding: 14,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ fontFamily: theme.fonts.mono, fontSize: '0.7rem', letterSpacing: 1.5, textTransform: 'uppercase', color: theme.colors.textMuted, margin: 0 }}>
          Utilities — graph display
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={reset} style={{ background: 'none', border: 'none', color: '#ffd166', cursor: 'pointer', fontSize: '0.68rem', fontFamily: theme.fonts.mono }}>
            reset
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.colors.textMuted, cursor: 'pointer' }}>✕</button>
        </div>
      </div>

      {TOGGLE_TYPES.map((t) => (
        <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontFamily: theme.fonts.body, fontSize: '0.8rem', color: theme.colors.text, cursor: 'pointer' }}>
          <input type="checkbox" checked={typeOn(vis, t)} onChange={() => toggle(t)} style={{ accentColor: theme.colors.accentBlue }} />
          {t}
        </label>
      ))}
    </div>
  )
}
