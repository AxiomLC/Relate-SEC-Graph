import { Component, useState } from 'react'
import CommandBar from './components/CommandBar.jsx'
import NeuralMap from './components/NeuralMap.jsx'
import LogDrawer from './components/LogDrawer.jsx'
import UtilitiesDrawer from './components/UtilitiesDrawer.jsx'
import Viewer from './components/Viewer.jsx'
import { TOGGLE_TYPES, visibleNodeTypes } from './config/nodeTypes.js'
import { runSemanticSearch } from './lib/api.js'

// Minimal error boundary — a render error shows a message instead of a
// white screen (React unmounts the tree on uncaught render errors).
class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#f2f2f2', fontFamily: 'monospace', fontSize: '0.85rem' }}>
          <h3 style={{ color: '#f87171' }}>Frontal Lobe hit a rendering error</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error)}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 12, padding: '4px 12px', background: '#b35900', color: '#fff', border: 'none', cursor: 'pointer' }}>
            Try to recover
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// App shell — Cognitive Obsidian.
// Layout (frozen): CommandBar top · left region = Voice (hidden) + Map + Log
// drawer (spans map+voice width only) · Inspector right, full height.
// Beta 2.4 (16 Aug 26): the Viewer is a stack (Search Wiring.md §4) fed by
// `viewerPush` — App owns the halo target (map + result-row selects only —
// Back NEVER touches the map) and the semantic search handler.
export default function App() {
  const [logOpen, setLogOpen] = useState(false)
  const [inputOpen, setInputOpen] = useState(false)
  const [utilsOpen, setUtilsOpen] = useState(false)
  // Utilities filters (Beta 2.1, 10 Aug 26): node-type visibility. null = all
  // on. Owned here so the drawer writes and the map read the SAME object.
  // Persisted to localStorage so toggles survive a reload (user-approved).
  // 10 Aug 26: CONTRACT > / CONTRACT < are plain keys in this object (the
  // band meta on the node decides which key applies) — no separate plumbing.
  const [entityTypes, setEntityTypesState] = useState(() => {
    try {
      const raw = localStorage.getItem('fl_utils_entity_types')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const setEntityTypes = (next) => {
    setEntityTypesState(next)
    try {
      if (next == null) localStorage.removeItem('fl_utils_entity_types')
      else localStorage.setItem('fl_utils_entity_types', JSON.stringify(next))
    } catch { /* storage may be unavailable — filters still work in-memory */ }
  }

  // Map halo target — set ONLY by map click and result-row select (§5).
  // Back / Connections navigation never move it.
  const [haloId, setHaloId] = useState(null)
  // Fly-to target (22 Aug 26): set ONLY by result-row select — the camera
  // rotates to this node. Map clicks deliberately don't set it (9 Aug 26
  // rule: clicking around shouldn't yank the view).
  const [flyToId, setFlyToId] = useState(null)
  // Map data version — bumped after a COGNITION mint so the map refetches
  // and the new gold node appears (Cognition Build.md §6.4).
  const [graphVersion, setGraphVersion] = useState(0)
  // Viewer stack feed — every push becomes a new Viewer content state.
  const [viewerPush, setViewerPush] = useState({ seq: 0, kind: null })
  const pushState = (entry) => setViewerPush((p) => ({ seq: p.seq + 1, ...entry }))

  const handleMapSelect = (node) => {
    setHaloId(node?.id ?? null)
    pushState({ kind: 'node', node })
  }
  // Result-row select → state1 node view + map halo (result is always on-screen,
  // §3 scoping).
  const handleResultSelect = (row) => {
    setHaloId(row?.id ?? null)
    setFlyToId(row?.id ?? null)
    pushState({
      kind: 'node',
      node: {
        id: row.id,
        label: row.name,
        type: row.type,
        ticker: row.ticker,
        contract_band: row.meta?.contract_band,
        caption: row.caption,
        summary: row.meta?.summary,
      },
    })
  }
  // Connections buttons in the Viewer — navigation only, no halo.
  const handleNavigate = (node) => pushState({ kind: 'node', node })

  // Semantic search from the top bar. Utilities rules everything (§3): the
  // allowlist rides along, and the hidden-type count rides into the results
  // state so the query header can show "N hidden by Utilities".
  const handleSearch = async (text) => {
    const q = (text || '').trim()
    if (!q) return
    const { types, hiddenBands } = visibleNodeTypes(entityTypes)
    const hidden = TOGGLE_TYPES.filter((t) => (entityTypes ?? {})[t] === false).length
    try {
      const results = await runSemanticSearch(q, types, hiddenBands)
      pushState({ kind: 'results', results, query: q, hidden })
    } catch (e) {
      pushState({
        kind: 'results',
        results: null,
        query: q,
        hidden,
        error: String((e && e.message) || e).replace(/^API \/semantic failed: /, ''),
      })
    }
  }

  return (
    <ErrorBoundary>
      <div className="app-shell">
      <CommandBar
        logOpen={logOpen}
        inputOpen={inputOpen}
        utilsOpen={utilsOpen}
        entityTypes={entityTypes}
        onEntityTypes={setEntityTypes}
        onToggleLog={() => setLogOpen((v) => !v)}
        onToggleInput={() => setInputOpen((v) => !v)}
        onToggleUtils={() => setUtilsOpen((v) => !v)}
        onSearch={handleSearch}
        onCypherResults={(payload, q) => {
          const hidden = TOGGLE_TYPES.filter((t) => (entityTypes ?? {})[t] === false).length
          pushState({ kind: 'results', results: payload, query: q || '(cypher)', hidden })
        }}
      />
      <div className="app-body">
        <div className="left-region">
          <div className="content-row">
            <NeuralMap onSelectNode={handleMapSelect} entityTypes={entityTypes} haloId={haloId} flyToId={flyToId} graphVersion={graphVersion} />
          </div>
          <LogDrawer open={logOpen} />
        </div>
        <Viewer
          push={viewerPush}
          onResultSelect={handleResultSelect}
          onNavigate={handleNavigate}
          onMint={() => setGraphVersion((v) => v + 1)}
        />
      </div>
      </div>
    </ErrorBoundary>
  )
}
