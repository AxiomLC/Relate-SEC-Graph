import { useEffect, useMemo, useState } from 'react'
import { getNodeDetail } from '../lib/api.js'

// Viewer — RIGHT panel, full height, ALWAYS ON. The results surface for the
// search bar + voice + node details. Beta 2.4 (16 Aug 26): it is now a
// TIMELINE of "Viewer content states" (Search Wiring.md §4 — locked):
//   · uniform entries — {kind:'node'} or {kind:'results'} — recorded from the
//     point of refresh, purged on browser refresh (sessionStorage write-through
//     but removed on mount), capped at 50, consecutive duplicates deduped,
//     a new action after Back truncates the forward path.
//   · state0 = results table (one row per node, type-aware meta + connection
//     counts) in the main box; the small strip above = query header (query
//     text, count, hidden-by-Utilities, sort, elapsed).
//   · top strip: Connections button LEFT of the search bar; <-Back button
//     RIGHT. Connections is inert on state0 (no node selected yet). Back is
//     pure state restore — dead at the bottom, NEVER touches the map, NEVER
//     re-runs a query.
//   · selecting a result row → state1 = that node's normal view (summary +
//     chunks + find-in-text + Connections popdown).
// Corner ⛶ toggles normal (25%) / full (40%) width — 2-position preset.

function highlight(text, term) {
  // Split the chunk text on the search term; matches render as <mark>.
  if (!term) return text
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return parts.map((p, i) =>
    p.toLowerCase() === term.toLowerCase() ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>
  )
}

// One line from the row's type-aware meta dict (already picked server-side).
function rowMetaLine(r) {
  if (!r.meta) return ''
  const vals = Object.values(r.meta).filter((v) => v != null && v !== '')
  const s = vals.join(' · ').replace(/\s+/g, ' ').trim()
  return s.length > 150 ? `${s.slice(0, 149)}…` : s
}

export default function Viewer({ push, onResultSelect, onNavigate, onMint }) {
  const [full, setFull] = useState(false)
  // the timeline — one state object so push/dedupe/truncate/cap are atomic
  const [hist, setHist] = useState({ stack: [], idx: -1 })
  // node-view state (per current node state)
  const [detail, setDetail] = useState(null)
  const [page, setPage] = useState(0)
  const [term, setTerm] = useState('')
  const [showConnections, setShowConnections] = useState(false)

  // Purge on refresh: the stack must NOT survive a browser reload (§4).
  useEffect(() => { sessionStorage.removeItem('fl_viewer_stack') }, [])
  // Write-through to sessionStorage (survives HMR remounts within the tab).
  useEffect(() => {
    if (!hist.stack.length) return
    try { sessionStorage.setItem('fl_viewer_stack', JSON.stringify(hist)) } catch { /* quota/private mode */ }
  }, [hist])

  // App-initiated pushes (map click, result-row select, search results, …).
  // Dedupe ONLY accidental consecutive NODE clicks (same id) — a re-run of the
  // same search is always a legit new state (Utilities may have changed).
  useEffect(() => {
    if (!push?.kind) return
    setHist((h) => {
      const prev = h.stack[h.idx]
      const same = prev && push.kind === 'node' && prev.kind === 'node' && prev.node?.id === push.node?.id
      if (same) return h // consecutive duplicate node click
      const stack = [...h.stack.slice(0, h.idx + 1), push].slice(-50) // truncate forward + cap
      return { stack, idx: Math.min(h.idx + 1, stack.length - 1) }
    })
  }, [push])

  const current = hist.idx >= 0 ? hist.stack[hist.idx] : null
  const isResults = current?.kind === 'results'

  // Fetch summary + ordered chunks + neighbors whenever the current state is a
  // node (Back to an old node state re-fetches — content is idempotent).
  useEffect(() => {
    setDetail(null)
    setPage(0)
    setShowConnections(false)
    const id = current?.kind === 'node' ? current.node?.id : null
    if (!id) return
    let live = true
    getNodeDetail(id)
      .then((d) => { if (live) { setDetail(d); setTerm('') } })
      .catch(() => { if (live) setDetail({ summary: null, ticker: null, chunks: [], neighbors: [] }) })
    return () => { live = false }
  }, [current?.kind, current?.node?.id])

  // Back = pure state restore: never touches the map, never re-runs a query.
  const back = () => {
    setHist((h) => (h.idx <= 0 ? h : { ...h, idx: h.idx - 1 }))
  }

  const node = current?.kind === 'node' ? current.node : null
  const chunks = detail?.chunks || []
  const total = chunks.length

  const pageSafe = Math.min(page, Math.max(0, total - 1))
  const cur = chunks[pageSafe]

  // Matches on the current page (for the search bar counter).
  const matchCount = useMemo(() => {
    if (!term || !cur) return 0
    return (cur.text.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
  }, [term, cur])

  // Jump to the next page containing a match (wraps around).
  const nextMatchPage = () => {
    if (!term || total < 2) return
    for (let step = 1; step <= total; step++) {
      const i = (pageSafe + step) % total
      if (new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(chunks[i].text)) {
        setPage(i)
        return
      }
    }
  }

  // Display label: first-letter-capitalized for non-official types; long
  // clause names truncate at ~8 words with the full name on hover.
  const displayLabel = (() => {
    if (!node?.label) return node?.label
    const isOfficial = node.type === 'TICKER' || node.type === 'COMPANY' || node.type === 'CONTRACT' || node.type === 'DEAL_EVENT' || node.type === 'PATENT' || node.type === 'PATENT_INVENTORY'
    let text = isOfficial ? node.label : node.label.charAt(0).toUpperCase() + node.label.slice(1)
    if (!isOfficial && node.type !== 'SUBSIDIARY') {
      const words = text.split(/\s+/)
      if (words.length > 8) {
        const cut = words.slice(0, 8).join(' ').replace(/[,;:]+$/, '')
        text = cut + '…'
      }
    }
    return text
  })()

  const metaLine = node
    ? [
        node.type !== 'TICKER' && (node.ticker || detail?.ticker),
        node.type === 'CONTRACT' && (node.contract_band === '>' || node.contract_band === '<')
          ? `CONTRACT ${node.contract_band}`
          : node.type,
        node.type === 'PATENT' && (detail?.meta?.patent_number || detail?.meta?.application_number)
          ? `${detail.meta.patent_number || detail.meta.application_number} · ${detail.meta.status || ''} · filed ${detail.meta.filing_date || ''}`.replace(/\s+·\s*$/, '')
          : null,
        node.type === 'PATENT_INVENTORY' && detail?.meta?.app_count
          ? `${detail.meta.app_count} filings in the inventory`
          : null,
        detail?.meta?.accession,
        detail?.meta?.exhibit &&
          `${detail.meta.exhibit} (${detail.meta.form}, filed ${detail.meta.filing_date})`,
      ].filter(Boolean).join(' · ')
    : ''

  const m = current?.results?.meta || {}
  const queryHeader = isResults
    ? [
        current.query,
        current.error ? 'error' : `${m.count} result${m.count === 1 ? '' : 's'}`,
        m.hidden_by_utilities && `${current.hidden ?? 0} hidden by Utilities`,
        m.sort ? `sort ${m.sort}` : '',
        m.elapsed_ms != null ? `${m.elapsed_ms}ms` : '',
      ].filter(Boolean).join(' · ')
    : ''

  return (
    <div className={`viewer${full ? ' full' : ''}`}>
      <div className="panel-corner">
        <button
          className="corner-btn"
          onClick={() => setFull((v) => !v)}
          title={full ? 'Normal width' : 'Full width'}
        >
          ⛶
        </button>
      </div>
      {current ? (
        <>
          {/* top strip (§4): Connections LEFT of the search bar · <-Back RIGHT */}
          <div className="viewer-strip">
            <button
              className="corner-btn"
              disabled={isResults}
              onClick={() => setShowConnections((v) => !v)}
              title={isResults ? 'Connections — select a result first' : 'Connections'}
              style={!isResults && showConnections ? { color: '#f5c542' } : undefined}
            >
              Connections
            </button>
            {isResults ? (
              <div className="viewer-strip-query" title={current.query}>{queryHeader}</div>
            ) : (
              <input
                className="viewer-search"
                placeholder="Find in text…"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') nextMatchPage() }}
              />
            )}
            <button className="corner-btn" disabled={hist.idx <= 0} onClick={back} title="Back — restores the previous Viewer state">
              ‹ Back
            </button>
          </div>

          {isResults ? (
            <div className="results">
              {current.error ? (
                <div className="empty">{current.error}</div>
              ) : !current.results?.rows?.length ? (
                <div className="empty">No results{current.query ? ` for “${current.query}”` : ''}.</div>
              ) : (
                <div className="results-table">
                  {current.results.rows.map((r, i) => (
                    <button
                      key={r.id || i}
                      className="result-row"
                      onClick={() => onResultSelect && onResultSelect(r)}
                      title={r.id}
                    >
                      <span className="rr-type">{r.type}</span>
                      <span className="rr-main">
                        <span className="rr-name">{r.name}</span>
                        {r.caption && r.caption !== r.name && <span className="rr-caption">{r.caption}</span>}
                        {rowMetaLine(r) && <span className="rr-meta">{rowMetaLine(r)}</span>}
                      </span>
                      <span className="rr-side">
                        {r.score != null && <span className="rr-score">{(r.score * 100).toFixed(0)}%</span>}
                        {r.type !== 'SCALAR' && <span className="rr-degree">{r.degree} conn</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="results">
              <div className="section">
                {(detail?.summary || node.summary) && (
                  <div style={{ fontFamily: 'var(--font-body)', color: '#f5c542', fontSize: '0.72rem', marginBottom: 4 }}>
                    {detail?.summary || node.summary}
                  </div>
                )}
                <div
                  title={node.label}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.84rem', color: 'var(--text)', marginBottom: 4 }}
                >
                  {displayLabel}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  {metaLine}
                </div>
              </div>
              <div className="section">
                {showConnections && (
                  <div className="connections" style={{ marginBottom: 8, maxHeight: 160, overflowY: 'auto', fontSize: '0.7rem', fontFamily: 'var(--font-mono)' }}>
                    {detail?.neighbors?.length ? (
                      detail.neighbors.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => onNavigate && onNavigate({ id: n.id, label: n.name, type: n.type })}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '2px 4px', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer' }}
                        >
                          <span style={{ color: '#9a9a9a' }}>{n.edge}</span> → <span style={{ color: '#f5c542' }}>{n.type}</span> · {n.name}
                        </button>
                      ))
                    ) : (
                      <div className="empty">No visible connections.</div>
                    )}
                  </div>
                )}
                {cur ? (
                  <div className="markdown" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', lineHeight: 1.5, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                    {highlight(cur.text, term)}
                  </div>
                ) : (
                  <div className="empty">
                    {detail ? 'No source text for this node (deterministic node — ticker anchor or subsidiary list entry).' : 'Loading…'}
                  </div>
                )}
              </div>
              {total > 1 && (
                <div className="pagination" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', padding: '6px 0' }}>
                  <button className="corner-btn" disabled={pageSafe === 0} onClick={() => setPage(pageSafe - 1)}>‹</button>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {pageSafe + 1} / {total}
                  </span>
                  <button className="corner-btn" disabled={pageSafe >= total - 1} onClick={() => setPage(pageSafe + 1)}>›</button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontFamily: 'var(--font-body)', fontSize: '0.85rem' }}>
          Viewer
        </div>
      )}
    </div>
  )
}
