import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { theme } from '../config/theme.js'
import { deleteTicker, exportGraph, getTickers, rebuildGraph, restoreGraph, runIngest, runIngestPatents, runIngestUsaspending, truncateGraph } from '../lib/api.js'

// ⚙ INPUT drawer — what to FETCH / MANAGE, in two columns:
//   left  = Input (tickers + sources + re-run warnings)
//   right = Manage DB (Delete All · tickers-to-delete · Rebuild)
// Secrets NEVER appear here (keys live in backend .env).

const SOURCES = [
  { id: 'sec', label: 'SEC contracts', status: 'DONE', phase: 'live' },
  { id: 'uspto', label: 'USPTO patents', status: 'LIVE', phase: 'live' },
  { id: 'usaspending', label: 'USASpending', status: 'LIVE', phase: 'live' },
]

const label = {
  fontFamily: theme.fonts.mono,
  fontSize: '0.65rem',
  letterSpacing: 1,
  textTransform: 'uppercase',
  color: theme.colors.textMuted,
}

const btn = (color) => ({
  width: '100%',
  padding: '6px 8px',
  cursor: 'pointer',
  background: 'none',
  color,
  border: `1px solid ${color}`,
  borderRadius: 3,
  fontFamily: theme.fonts.mono,
  fontSize: '0.65rem',
  letterSpacing: 1,
})

export default function InputDrawer({ open, onClose }) {
  const [tickers, setTickers] = useState('QUBT, IONQ, RGTI')
  const [deleteList, setDeleteList] = useState('')
  const [enabled, setEnabled] = useState({ sec: true, uspto: true, usaspending: false })
  const [running, setRunning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportMode, setExportMode] = useState('full')
  const [exporting, setExporting] = useState(false)
  const [lastJob, setLastJob] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const fileRef = useRef(null)
  const queryClient = useQueryClient()

  // Per-ticker ingest records — re-run warning source.
  const { data: tickerMeta } = useQuery({ queryKey: ['tickers'], queryFn: getTickers, enabled: open })

  if (!open) return null

  const metaByTicker = (tickerMeta || []).reduce((m, t) => {
    m[t.ticker] = t
    return m
  }, {})
  const listed = tickers.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
  const already = listed.filter((t) => metaByTicker[t])

  const refreshAll = () => {
    ;['kb', 'tickers', 'jobs'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }))
  }

  const run = async () => {
    const list = tickers.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
    if (list.length === 0) return
    setRunning(true)
    setError(null)
    setLastJob(null)
    try {
      // 14 Aug 26: the Run button fires every LIVE source that's checked —
      // SEC contracts and/or USPTO patents. 16 Aug 26: USASpending joins.
      const jobs = []
      const fired = []
      if (enabled.sec) {
        const res = await runIngest(list)
        jobs.push(res.job_id)
        fired.push('SEC')
      }
      if (enabled.uspto) {
        const res = await runIngestPatents(list)
        jobs.push(res.job_id)
        fired.push('USPTO')
      }
      if (enabled.usaspending) {
        const res = await runIngestUsaspending(list)
        jobs.push(res.job_id)
        fired.push('USASpending')
      }
      if (jobs.length === 0) {
        setError('No source selected — check SEC, USPTO patents, or USASpending')
        return
      }
      setLastJob({ fired, jobs })
      queryClient.invalidateQueries({ queryKey: ['tickers'] })
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setRunning(false)
    }
  }

  const delList = async () => {
    const list = deleteList.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
    if (list.length === 0 || deleting) return // in-flight guard — no double-fire
    if (!window.confirm(`Delete ${list.join(', ')}? Shared entities stay.`)) return
    setDeleting(true)
    try {
      for (const t of list) await deleteTicker(t)
      setDeleteList('')
      refreshAll()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setDeleting(false)
    }
  }

  const rebuild = async () => {
    try {
      await rebuildGraph()
      refreshAll()
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  const truncate = async () => {
    const word = window.prompt('Type RESET to wipe the ENTIRE graph (no undo):')
    if (word !== 'RESET') return
    try {
      await truncateGraph()
      setTickers('QUBT, IONQ, RGTI')
      refreshAll()
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  const startExport = async () => {
    if (exporting) return
    setExporting(true)
    setError(null)
    setNotice(null)
    try {
      const data = await exportGraph(exportMode === 'lean')
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `frontal-lobe-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      const kb = Math.round(json.length / 1024)
      setNotice(`Backup saved — ${kb} KB · ${data.counts.nodes} nodes · ${data.counts.relationships} rels`)
      setExportOpen(false)
    } catch (e) {
      setError(String(e.message || e))
      setExportOpen(false)
    } finally {
      setExporting(false)
    }
  }

  const doRestore = async (file) => {
    const text = await file.text()
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      setError('Not a valid backup JSON')
      return
    }
    if (!Array.isArray(payload.nodes) || !Array.isArray(payload.relationships)) {
      setError('Not a Frontal Lobe backup file')
      return
    }
    const n = payload.counts?.nodes ?? payload.nodes.length
    if (!window.confirm(`Restore ${n} nodes? This WIPES the current graph first.`)) return
    setRestoring(true)
    setError(null)
    setNotice(null)
    try {
      const res = await restoreGraph(payload)
      refreshAll()
      setNotice(`Restored — ${res.nodes_imported} nodes · ${res.relationships_imported} relationships`)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setRestoring(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 46,
        right: 96,
        width: 470,
        zIndex: 20,
        background: theme.colors.bgHeader,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: 4,
        padding: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      }}
    >
      <button
        onClick={onClose}
        style={{ position: 'absolute', top: 4, right: 6, background: 'none', border: 'none', color: theme.colors.textMuted, cursor: 'pointer', fontSize: '0.8rem' }}
      >
        ✕
      </button>

      <div style={{ display: 'flex', gap: 14 }}>
        {/* ── INPUT ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={label}>Input</span>
            <input
              value={tickers}
              onChange={(e) => setTickers(e.target.value)}
              style={{
                flex: 1,
                minWidth: 0,
                padding: 5,
                background: theme.colors.bgBase,
                border: `1px solid ${theme.colors.border}`,
                color: theme.colors.text,
                borderRadius: 3,
                fontFamily: theme.fonts.body,
                fontSize: '0.8rem',
              }}
            />
            <button
              onClick={run}
              disabled={running}
              title="Run ingestion"
              style={{
                padding: '5px 9px',
                cursor: running ? 'wait' : 'pointer',
                background: theme.colors.bgBase,
                color: theme.colors.text,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: 3,
                fontFamily: theme.fonts.mono,
                fontSize: '0.7rem',
              }}
            >
              {running ? '…' : '▶'}
            </button>
          </div>

          {listed.length > 5 && (
            <div style={{ marginBottom: 6, fontFamily: theme.fonts.mono, fontSize: '0.62rem', color: '#ffd166' }}>
              ⚠ Over {listed.length} tickers can choke ingest RAM — consider running fewer at once
            </div>
          )}

          {SOURCES.map((s) => (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontFamily: theme.fonts.body, fontSize: '0.72rem', color: theme.colors.text }}>
              <input
                type="checkbox"
                checked={enabled[s.id]}
                onChange={() => setEnabled((p) => ({ ...p, [s.id]: !p[s.id] }))}
                disabled={s.phase !== 'live'}
                style={{ accentColor: theme.colors.accentBlue, width: 12, height: 12 }}
              />
              <span>{s.label}</span>
              <span style={{ marginLeft: 'auto', fontFamily: theme.fonts.mono, fontSize: '0.56rem', color: s.phase === 'live' ? theme.colors.glowOrange : theme.colors.textMuted }}>
                {s.status}
              </span>
            </label>
          ))}

          {already.map((t) => {
            const m = metaByTicker[t]
            return (
              <div key={t} style={{ marginTop: 4, fontFamily: theme.fonts.mono, fontSize: '0.62rem', color: '#ffd166' }}>
                ⚠ {t} already ingested · {m.extraction_version} · last run {new Date(m.last_run_at).toLocaleDateString()}
              </div>
            )
          })}
          {lastJob && (
            <div style={{ marginTop: 4, fontFamily: theme.fonts.mono, fontSize: '0.6rem', color: theme.colors.glowOrange }}>
              {Array.isArray(lastJob.fired)
                ? `${lastJob.fired.join(' + ')} job(s) started — ${lastJob.jobs.join(' · ')} — see Log → Jobs`
                : `Job ${lastJob} started — see Log → Jobs`}
            </div>
          )}
          {error && (
            <div style={{ marginTop: 4, fontFamily: theme.fonts.body, fontSize: '0.65rem', color: '#ff5555' }}>{error}</div>
          )}
        </div>

        {/* ── MANAGE DB ── */}
        <div style={{ width: 196, borderLeft: `1px solid ${theme.colors.border}`, paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={label}>Manage DB</span>
          <button onClick={truncate} title="Wipe the entire graph (typed confirmation)" style={btn('#ff5555')}>
            Delete All
          </button>
          <input
            value={deleteList}
            onChange={(e) => setDeleteList(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && delList()}
            placeholder="tickers to delete"
            style={{
              padding: 5,
              background: theme.colors.bgBase,
              border: `1px solid ${theme.colors.border}`,
              color: theme.colors.text,
              borderRadius: 3,
              fontFamily: theme.fonts.body,
              fontSize: '0.75rem',
            }}
          />
          <button onClick={delList} disabled={!deleteList.trim() || deleting} style={{ ...btn('#ff7b7b'), opacity: deleteList.trim() && !deleting ? 1 : 0.4 }}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button onClick={rebuild} title="Repair: merge duplicates + sweep orphans (shared entities stay)" style={btn('#ffd166')}>
            Rebuild
          </button>
          <button onClick={() => setExportOpen(true)} title="Backup the graph — choose Full or Lean" style={btn('#4ade80')}>
            Export backup
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={restoring} title="Restore from a backup JSON — WIPES the current graph first" style={{ ...btn('#ffb347'), opacity: restoring ? 0.5 : 1 }}>
            {restoring ? 'Restoring…' : 'Restore backup'}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) doRestore(f) }} />
          {notice && (
            <div style={{ fontFamily: theme.fonts.mono, fontSize: '0.6rem', color: '#8ef0a0', lineHeight: 1.4 }}>{notice}</div>
          )}
        </div>
      </div>

      {/* ── EXPORT MODAL ── */}
      {exportOpen && (
        <div
          onClick={() => !exporting && setExportOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: theme.colors.bgHeader, border: `1px solid ${theme.colors.border}`, borderRadius: 4, padding: 16, width: 360, boxShadow: '0 12px 32px rgba(0,0,0,0.7)' }}
          >
            <div style={{ ...label, marginBottom: 8 }}>Export backup</div>
            {[
              { id: 'full', t: 'Full (recommended)', d: 'everything incl. search vectors · ~21 MB · ~1 min — restore works instantly, nothing to redo', ok: true },
              { id: 'lean', t: 'Compact (no vectors)', d: 'all entities + edges, vectors stripped · ~4 MB · similar time (free-tier transfer is the bottleneck) — restore needs a re-embed pass (~$0.01) before search works', ok: false },
            ].map((o) => (
              <label key={o.id} style={{ display: 'flex', gap: 8, padding: '5px 0', cursor: 'pointer', fontFamily: theme.fonts.body, fontSize: '0.72rem', color: theme.colors.text }}>
                <input type="radio" name="exportMode" checked={exportMode === o.id} onChange={() => setExportMode(o.id)} style={{ accentColor: theme.colors.accentBlue }} />
                <span>
                  <b style={{ color: o.ok ? '#4ade80' : theme.colors.textMuted }}>{o.t}</b>
                  <div style={{ color: theme.colors.textMuted, fontSize: '0.62rem', lineHeight: 1.35 }}>{o.d}</div>
                </span>
              </label>
            ))}
            <div style={{ color: theme.colors.textMuted, fontSize: '0.6rem', fontFamily: theme.fonts.body, margin: '6px 0 10px' }}>
              Your browser will ask where to save the file. Sizes are for the current graph — the toast shows the real numbers after.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setExportOpen(false)} disabled={exporting} style={{ ...btn(theme.colors.textMuted), flex: 1 }}>
                Cancel
              </button>
              <button onClick={startExport} disabled={exporting} style={{ ...btn('#4ade80'), flex: 1.5, opacity: exporting ? 0.6 : 1 }}>
                {exporting ? (exportMode === 'full' ? 'Exporting… ~1 min' : 'Exporting…') : 'Start export'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
