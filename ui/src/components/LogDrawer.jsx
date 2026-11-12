import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as LucideIcons from 'lucide-react'
import { getEvents, getJobs, getKb, getMcpCalls } from '../lib/api.js'
import { theme } from '../config/theme.js'

// Log drawer — BOTTOM of the left region (spans map + voice width only;
// Viewer on the right is the always-on anchor). Corner ⛶ toggles
// normal (30% height) / full (60% — graph keeps a sliver).
// Tabs: Log (live event stream) · Jobs · KB (dashboard) · Cypher · MCP.
//
// KB is prefetched at page load (main.jsx) and cached 60s — the drawer
// only refetches when a NEW "Job finished" event appears in the stream.

const TABS = ['Log', 'Jobs', 'KB', 'Cypher', 'MCP']

// Event level → dot color (same palette as the Jobs tab statuses).
// info dulled to blue-gray (9 Aug 26) so green/yellow/red pop.
const LEVEL_COLOR = { info: '#7a8ba8', ok: '#7ee081', warn: '#ffd166', error: '#ff5555' }

// 16 Aug 26: each leg gets the icon of an anchor node type (from the theme —
// the single source of truth): SEC → CONTRACT_TERM.icon · USPTO → PATENT.icon ·
// USASpending → FEDERAL_AWARD.icon. Rendered in front of every leg-tagged log.
const LEG_NODE = { sec: 'CONTRACT_TERM', uspto: 'PATENT', usaspending: 'FEDERAL_AWARD' }
// 16 Aug 26: search events (Cypher tab) don't map to a node type — direct
// lucide icons: Braces for Cypher queries, Search for semantic queries.
const LEG_ICON = { cypher: 'Braces', semantic: 'Search' }

// The message span already shows the [TICKER] badge → drop a redundant leading
// "CLS:" / "▶ CLS: " prefix from the message text, keeping the ▶ arrow (16 Aug 26).
function stripTickerPrefix(msg, ticker) {
  if (!ticker || !msg) return msg
  const esc = ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return msg.replace(new RegExp(`^(▶\\s*)?${esc}[\\s:–—\\-]+`, 'i'), '$1')
}

// The final leg logs carry a marker header ("*SEC Ingest Complete* write…") —
// render the *…* segment bold instead of literal asterisks (16 Aug 26).
function renderMessage(msg) {
  const m = (msg || '').match(/^\*([^*]+)\*(.*)$/)
  if (!m) return msg
  return [
    <b key="hdr" style={{ fontWeight: 700, color: 'var(--text)' }}>{m[1]}</b>,
    m[2],
  ]
}

const label = { fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: 1 }

export default function LogDrawer({ open }) {
  const [tab, setTab] = useState('Log')
  const [full, setFull] = useState(false)
  const [legFilter, setLegFilter] = useState('all') // 15 Aug 26: All · SEC · USPTO · USASpending
  const [searchFilter, setSearchFilter] = useState('all') // 16 Aug 26: Cypher tab — All · Cypher · Semantic
  const queryClient = useQueryClient()
  // Last seen "Job … finished" event ts — invalidate KB only on NEW completions.
  const lastFinishRef = useRef(null)

  const { data: events, isError: eventsError } = useQuery({
    queryKey: ['events'],
    queryFn: () => getEvents(),
    enabled: open && (tab === 'Log' || tab === 'Cypher'),
    refetchInterval: 3000, // live stream while the Log / Cypher tab is open
    refetchOnWindowFocus: false,
  })
  const { data: kb } = useQuery({
    queryKey: ['kb'],
    queryFn: getKb,
    enabled: open,
    staleTime: 60_000, // serve the cached dashboard; refetch only when invalidated
    refetchOnWindowFocus: false,
  })
  const { data: jobs } = useQuery({ queryKey: ['jobs'], queryFn: getJobs, enabled: open && tab === 'Jobs' })

  // MCP-call log — the MCP tab's data (cypher/semantic/node/graph calls).
  const { data: mcpCalls } = useQuery({
    queryKey: ['mcp_calls'],
    queryFn: () => getMcpCalls(100),
    enabled: open && tab === 'MCP',
    refetchInterval: 3000,
    refetchOnWindowFocus: false,
  })

  // When a job finishes, refresh the KB dashboard (it was prefetched at load).
  useEffect(() => {
    if (!events || events.length === 0) return
    // matches the job completion lines: old "Job X finished …" and the v13
    // "Ingest complete, write success; …" (6 Aug 26: wording changed, so the
    // old trigger silently stopped firing and the KB never refreshed)
    const finished = events.filter(
      (e) =>
        (e.message.startsWith('Job ') && e.message.includes('finished')) ||
        e.message.includes('Ingest Complete') // 16 Aug 26: *SEC/PATENT/USASpending Ingest Complete* headers
    )
    if (finished.length === 0) return
    const newest = finished[0].ts // events are newest-first
    if (lastFinishRef.current !== newest) {
      lastFinishRef.current = newest
      queryClient.invalidateQueries({ queryKey: ['kb'] })
    }
  }, [events, queryClient])

  if (!open) return null

  const eventRows = (list) =>
    list.map((e, i) => {
      const time = new Date(e.ts).toLocaleTimeString([], { hour12: false })
      // leg icon (16 Aug 26): the anchor-node icon per leg, from the theme;
      // search legs use direct lucide icons (LEG_ICON)
      const legNode = LEG_NODE[e.leg]
      const iconName = legNode ? theme.graph.nodes.byType[legNode]?.icon : LEG_ICON[e.leg] || null
      const Icon = iconName ? LucideIcons[iconName] : null
      return (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0', lineHeight: 1.4, flexWrap: 'wrap' }}>
          <span style={{ color: LEVEL_COLOR[e.level] || LEVEL_COLOR.info, flexShrink: 0, fontSize: '1.3em', lineHeight: 1 }}>●</span>
          <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{time}</span>
          {e.ticker && (
            <span style={{ color: 'var(--accent-blue)', fontWeight: 700, flexShrink: 0 }}>[{e.ticker}]</span>
          )}
          {Icon && (
            <Icon size={13} strokeWidth={1.8} style={{ flexShrink: 0, color: 'var(--text-muted)', alignSelf: 'center' }} />
          )}
          <span style={{ color: e.level === 'error' ? '#ff5555' : e.level === 'warn' ? '#ffd166' : 'var(--text)' }}>
            {renderMessage(stripTickerPrefix(e.message, e.ticker))}
          </span>
        </div>
      )
    })

  const logBody = () => {
    if (eventsError) return <span style={{ color: '#ff5555' }}>Failed to load event stream — API unreachable?</span>
    if (!events) return 'Loading…'
    if (events.length === 0) return 'No activity yet — run an ingestion from the Input drawer.'
    // 15 Aug 26: display-only leg filter — the stream is shared by concurrent
    // legs; the dropdown isolates one source (live or scrolled history alike,
    // because it filters whatever is rendered, and the 3s refetch keeps it live).
    const shown = legFilter === 'all' ? events : events.filter((e) => (e.leg || '') === legFilter)
    if (shown.length === 0) {
      return <span style={{ color: 'var(--text-muted)' }}>No {legFilter === 'usaspending' ? 'USASpending' : legFilter.toUpperCase()} events yet.</span>
    }
    return eventRows(shown)
  }

  // 16 Aug 26: the Agent tab = the MACHINE's view of each Marlowe exchange —
  const cypherBody = () => {
    if (eventsError) return <span style={{ color: '#ff5555' }}>Failed to load event stream — API unreachable?</span>
    if (!events) return 'Loading…'
    const searchEvents = events.filter((e) => e.leg === 'cypher' || e.leg === 'semantic')
    const shown = searchFilter === 'all' ? searchEvents : searchEvents.filter((e) => e.leg === searchFilter)
    if (shown.length === 0) {
      return <span style={{ color: 'var(--text-muted)' }}>No Cypher / semantic queries yet — run one from the search bar.</span>
    }
    return eventRows(shown)
  }

  // MCP-call log — the MCP tab: every graph call (cypher / semantic / node /
  // graph) with timing + result count, newest first.
  const mcpBody = () => {
    if (!mcpCalls) return 'Loading…'
    if (mcpCalls.length === 0) {
      return <span style={{ color: 'var(--text-muted)' }}>No MCP graph calls yet — run a search, click a node, or drive the app via MCP.</span>
    }
    const toolColor = { cypher: '#60a5fa', semantic: '#a29bfe', node: '#7ee081', graph: '#ffd166' }
    return mcpCalls.map((c, i) => (
      <div key={i} style={{ marginBottom: 4, fontFamily: 'var(--font-mono)', fontSize: '0.62rem', lineHeight: 1.5 }}>
        <span style={{ color: toolColor[c.tool] || 'var(--text)', fontWeight: 700 }}>{c.tool}</span>{' '}
        <span style={{ color: 'var(--text-muted)' }}>{new Date(c.ts).toLocaleTimeString([], { hour12: false })}</span>{' '}
        <span style={{ color: 'var(--text)' }} title={c.detail}>{c.detail}</span>
        <span style={{ color: 'var(--text-muted)' }}>
          {' · '}{c.count} row{c.count === 1 ? '' : 's'} · {c.elapsed_ms}ms
          {c.source === 'mcp' ? ' · via MCP' : ''}
        </span>
        {c.error && <span style={{ color: '#ff5555' }}> · {c.error}</span>}
      </div>
    ))
  }

  const jobsBody = () => {
    if (!jobs) return 'Loading…'
    if (jobs.length === 0) return 'No ingestion jobs yet — trigger one via Input drawer (Beta 1.2) or POST /ingest-sec.'
    return jobs.map((j) => (
      <div key={j.job_id} style={{ marginBottom: 6 }}>
        <span style={{ color: j.status === 'success' ? '#7ee081' : j.status === 'error' ? '#ff5555' : '#ffd166' }}>
          [{j.status}]
        </span>{' '}
        {j.job_id} · {Array.isArray(j.tickers) ? j.tickers.join(', ') : ''} · {j.started_at}
      </div>
    ))
  }

  const kbBody = () => {
    if (!kb) return 'Loading…'
    const fmtMoney = (n) => {
      if (n == null) return '—'
      if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
      if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
      if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
      return `$${n}`
    }
    // Neo4j emits 9-digit fractional seconds (…52.036000000+00:00) — JS Date
    // only parses 3, so clamp to milliseconds before parsing (18 Aug 26).
    const fmtDt = (s) => {
      if (!s) return '—'
      const n = new Date(String(s).replace(/(\.\d{3})\d+/, '$1'))
      return Number.isNaN(n.getTime()) ? '—' : n.toLocaleString()
    }
    const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '')
    const B = ({ children }) => <span style={{ fontWeight: 600 }}>{children}</span>
    const tickerCard = (t) => (
      <div key={t.ticker} style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10, paddingBottom: 6 }}>
        <div style={{ color: 'var(--text)' }}>
          {t.ticker} <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>— {t.company_name || t.canonical || '?'}</span>
        </div>
        <div style={{ color: 'var(--text-muted)' }}>
          {t.subsidiaries} subs · {t.nodes} entities · {t.chunks} chunks · {t.edges} edges
        </div>
        {t.contract && (
          <div style={{ color: 'var(--text-muted)' }}>
            {t.contract.exhibit_type} · {t.contract.source_form} · filed {t.contract.filing_date || '?'}
          </div>
        )}
        {t.patents != null && (
          <div style={{ color: 'var(--text-muted)' }}>
            {t.contracts} contracts · {t.awards} awards · {t.award_inventory} in award inventory
          </div>
        )}
        {t.patents != null && (
          <div style={{ color: 'var(--text-muted)' }}>
            {t.patents} featured patents · {t.patent_inventory} apps in inventory
          </div>
        )}
        {t.top_award && (
          <div style={{ color: 'var(--text-muted)' }}>
            <B>Top Award:</B> {fmtMoney(t.top_award.amount)} — {clip(t.top_award.name, 58)}{t.top_award.period ? ` (${t.top_award.period})` : ''}
          </div>
        )}
        {t.top_contract?.name && (
          <div style={{ color: 'var(--text-muted)' }}>
            <B>Top Contract:</B> {clip(t.top_contract.name, 58)}{t.top_contract.fd ? ` (filed ${t.top_contract.fd})` : ''}{t.top_contract.terms ? ` · ${t.top_contract.terms} terms` : ''}
          </div>
        )}
        {t.top_term && (
          <div style={{ color: 'var(--text)' }}>
            <B>Top Term:</B> {fmtMoney(t.top_term.amount)} — {clip(t.top_term.name, 58)}
          </div>
        )}
        {t.active_subs?.length > 0 && (
          <div style={{ color: 'var(--text-muted)' }}>
            <B>Top Subs:</B> {t.active_subs.map((s) => `${clip(s.name, 24)} (${s.deg})`).join(', ')}
          </div>
        )}
        {t.products?.length > 0 && (
          <div style={{ color: 'var(--text-muted)' }}>
            <B>Products:</B> {t.products.map((p) => clip(p, 30)).join(' · ')}
          </div>
        )}
        {t.techs?.length > 0 && (
          <div style={{ color: 'var(--text-muted)' }}>
            <B>Tech:</B> {t.techs.map((x) => clip(x, 30)).join(' · ')}
          </div>
        )}
        <div style={{ color: 'var(--text-muted)' }}>last run {fmtDt(t.last_run_at)}</div>
      </div>
    )
    const entityBlock = (
      <div style={{ breakInside: 'avoid' }}>
        <div style={label}>Entity types</div>
        <div style={{ columns: 2, columnGap: 18 }}>
          {kb.entities.map((e) => (
            <div key={e.type} style={{ color: 'var(--text)', breakInside: 'avoid' }}>
              {e.type}: <span style={{ color: 'var(--text-muted)' }}>{e.count}</span>
            </div>
          ))}
        </div>
      </div>
    )
    const relBlock = (
      <div style={{ breakInside: 'avoid' }}>
        <div style={label}>Relationships</div>
        <div style={{ columns: 2, columnGap: 18 }}>
          {kb.relationships.map((r) => (
            <div key={r.type} style={{ color: 'var(--text)', breakInside: 'avoid' }}>
              {r.type}: <span style={{ color: 'var(--text-muted)' }}>{r.count}</span>
            </div>
          ))}
        </div>
      </div>
    )
    const filingBlock = null
    const uniqueBlock = (
      <div style={{ marginBottom: 8 }}>
        <div style={label}>Unique Connections (cross-ticker)</div>
        {!kb.unique_connections || kb.unique_connections.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
            none yet — no entity links two ticker clusters in the loaded graph
          </div>
        ) : (
          kb.unique_connections.map((u, i) => (
            <div key={i} style={{ color: 'var(--text)' }}>
              {u.name} <span style={{ color: 'var(--text-muted)' }}>({u.type})</span>
              <span style={{ color: 'var(--text-muted)' }}> — bridges {(u.clusters || u.bridges || []).join(' · ')} ({u.links} links)</span>
            </div>
          ))
        )}
      </div>
    )
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text)' }}>
            entities {kb.nodes} · chunks {kb.chunks} · edges {kb.edges} · ~{kb.size_mb ?? 0} MB · updated {fmtDt(kb.updated_at)}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
          {kb.tickers.length === 0 && <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>none yet</div>}
          {kb.tickers.map(tickerCard)}
        </div>
        {uniqueBlock}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 16 }}>
          {entityBlock}
          {relBlock}
        </div>
      </div>
    )
  }

  const body = () => {
    switch (tab) {
      case 'Log':
        return logBody()
      case 'Jobs':
        return jobsBody()
      case 'KB':
        return kbBody()
      case 'Cypher':
        return cypherBody()
      case 'MCP':
        return mcpBody()
    }
  }

  return (
    <div className={`log-drawer open${full ? ' full' : ''}`}>
      <div className="log-top">
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <button className="corner-btn" onClick={() => setFull((v) => !v)} title={full ? 'Normal height' : 'Full height'}>
          ⛶
        </button>
      </div>
      <div className="content">
        {tab === 'Log' && (
          <div className="log-filter" style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6, fontFamily: 'var(--font-mono)', fontSize: '0.6rem' }}>
            <span style={{ color: 'var(--text-muted)', marginRight: 2 }}>Leg:</span>
            {['all', 'sec', 'uspto', 'usaspending'].map((l) => (
              <button
                key={l}
                onClick={() => setLegFilter(l)}
                style={{
                  padding: '2px 7px',
                  cursor: 'pointer',
                  background: 'none',
                  color: legFilter === l ? 'var(--accent-blue)' : 'var(--text-muted)',
                  border: legFilter === l ? '1px solid var(--accent-blue)' : '1px solid var(--border)',
                  borderRadius: 3,
                  fontFamily: 'inherit',
                  fontSize: '0.6rem',
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        {tab === 'Cypher' && (
          <div className="log-filter" style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6, fontFamily: 'var(--font-mono)', fontSize: '0.6rem' }}>
            <span style={{ color: 'var(--text-muted)', marginRight: 2 }}>Mode:</span>
            {['all', 'cypher', 'semantic'].map((m) => (
              <button
                key={m}
                onClick={() => setSearchFilter(m)}
                style={{
                  padding: '2px 7px',
                  cursor: 'pointer',
                  background: 'none',
                  color: searchFilter === m ? 'var(--accent-blue)' : 'var(--text-muted)',
                  border: searchFilter === m ? '1px solid var(--accent-blue)' : '1px solid var(--border)',
                  borderRadius: 3,
                  fontFamily: 'inherit',
                  fontSize: '0.6rem',
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        )}
        {body()}
      </div>
    </div>
  )
}
