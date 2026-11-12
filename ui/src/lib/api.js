// Thin API client for the Frontal Lobe Python microservice.
// Base URL from env (VITE_API_BASE), dev default http://localhost:8020 (Relate backend).

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8020'

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    // 16 Aug 26: surface the server's friendly `detail` (e.g. "Not valid
    // Cypher — …") so the search bar's warning area shows a real message
    // instead of just the HTTP status.
    let detail = ''
    try {
      const body = await res.json()
      if (body && body.detail) detail = `: ${String(body.detail)}`
    } catch { /* non-JSON error body — status only */ }
    throw new Error(`API ${path} failed${detail}`)
  }
  return res.json()
}

// GET /health — liveness probe
export const getHealth = () => request('/health')

// GET /stats — node/edge counts for telemetry
export const getStats = () => request('/stats')

// GET /config — tuning knobs the UI shows (score threshold, boring term cap)
export const getConfig = () => request('/config')

// GET /kb — knowledge-base dashboard (per-ticker specs + filings)
export const getKb = () => request('/kb')

// GET /jobs — recent ingestion jobs (newest first)
export const getJobs = () => request('/jobs')

// GET /events — pipeline event stream for the Log tab (newest first)
export const getEvents = (limit = 200) => request(`/events?limit=${limit}`)

// GET /mcp-calls — recent MCP-style graph calls (cypher/semantic/node/graph)
export const getMcpCalls = (limit = 100) => request(`/mcp-calls?limit=${limit}`)

// GET /tickers — per-ticker ingest records (re-run warning in Input drawer)
export const getTickers = () => request('/tickers')

// POST /ingest — UI trigger (Input drawer "Run"). Demo mode: no key.
export const runIngest = (tickers) =>
  request('/ingest', { method: 'POST', body: JSON.stringify({ tickers }) })

// POST /ingest-patents — USPTO patent leg (Input drawer "USPTO patents")
export const runIngestPatents = (tickers) =>
  request('/ingest-patents', { method: 'POST', body: JSON.stringify({ tickers }) })

export const runIngestUsaspending = (tickers) =>
  request('/ingest-usaspending', { method: 'POST', body: JSON.stringify({ tickers }) })

// POST /delete-ticker — remove one ticker's data (shared entities survive)
export const deleteTicker = (ticker) =>
  request('/delete-ticker', { method: 'POST', body: JSON.stringify({ ticker }) })

// POST /rebuild — repair pass (canonical merge + orphan sweep)
export const rebuildGraph = () => request('/rebuild', { method: 'POST' })

// POST /truncate — full reset (wipes the entire graph)
export const truncateGraph = () => request('/truncate', { method: 'POST' })

// GET /export — graph backup JSON (lean = all nodes, embedding vectors stripped)
export const exportGraph = (lean = false) => request(`/export${lean ? '?lean=true' : ''}`)

// POST /restore — wipe + import a backup JSON (destructive)
export const restoreGraph = (payload) =>
  request('/restore', { method: 'POST', body: JSON.stringify(payload) })

// GET /graph — full graph { nodes, links } for the 3D map (Beta 1.2)
export const getGraph = () => request('/graph')

// GET /node/{id} — Viewer payload: summary headline + source-chunk markdown
export const getNodeDetail = (id) => request(`/node/${encodeURIComponent(id)}`)

// POST /query — hybrid Cypher + vector search (Beta 1.2)
export const postQuery = (text) =>
  request('/query', { method: 'POST', body: JSON.stringify({ text }) })

// POST /cypher — read-only Cypher search (Beta 2.4, 16 Aug 26).
// The Utilities allowlist rides along: types = visible node types,
// hiddenBands = contract bands toggled off (Search Wiring.md §3).
export const runCypherQuery = (query, types, hiddenBands, limit = 200) =>
  request('/cypher', {
    method: 'POST',
    body: JSON.stringify({ query, types, hidden_bands: hiddenBands, limit }),
  })

// POST /semantic — semantic (vector) search (Beta 2.4, 16 Aug 26).
// Same allowlist contract as /cypher; same {rows, meta} Viewer payload.
export const runSemanticSearch = (text, types, hiddenBands, limit = 20) =>
  request('/semantic', {
    method: 'POST',
    body: JSON.stringify({ text, types, hidden_bands: hiddenBands, limit }),
  })

export { API_BASE }
