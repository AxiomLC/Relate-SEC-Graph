import { useEffect, useRef, useState } from 'react'
import { Cog, Scroll, TableOfContents } from 'lucide-react'
import { runCypherQuery } from '../lib/api.js'
import { visibleNodeTypes } from '../config/nodeTypes.js'
import InputDrawer from './InputDrawer.jsx'
import UtilitiesDrawer from './UtilitiesDrawer.jsx'

// Top bar: Frontal Lobe™ brand (Courier, orange glow), semantic search,
// and toggles: Log drawer · Input · Utilities.
// The search bar carries a pure on/off "Cypher" chip — OFF = semantic
// (vector), ON = a plain Cypher textarea. User writes or pastes Cypher
// directly (no template modal). Enter runs in either mode.

export default function CommandBar({
  logOpen, inputOpen, utilsOpen,
  entityTypes, onEntityTypes,
  onToggleLog, onToggleInput, onToggleUtils,
  onSearch, onCypherResults,
}) {
  const [cypherMode, setCypherMode] = useState(false)
  const [query, setQuery] = useState('') // the box — semantic text OR Cypher (no saved state)
  const [cypherBusy, setCypherBusy] = useState(false)
  const [cypherInfo, setCypherInfo] = useState(null) // {text} — yellow warning in the bar
  const barRef = useRef(null)

  // NO saved state for the box — closing Cypher mode (chip off, clean run)
  // and Entered searches both refresh it.
  const closeCypher = () => {
    setCypherMode(false)
    setQuery('')
  }
  const toggleCypher = () => {
    if (cypherMode) setQuery('') // leaving Cypher mode → fresh semantic box
    setCypherMode((v) => !v)
  }

  // entering Cypher mode: the bar is the entry surface — focus it
  useEffect(() => {
    if (cypherMode) barRef.current?.focus()
  }, [cypherMode])

  // keep the textarea 2-line-expanding
  useEffect(() => {
    if (!cypherMode || !barRef.current) return
    const el = barRef.current
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [cypherMode, query])

  const runSearch = () => {
    const q = query.trim()
    if (!q) return
    onSearch && onSearch(q)
  }

  // Enter in Cypher mode: run. Valid run → results to the Viewer, chip flips
  // off. Error → warning stays in the bar.
  const runCypher = async () => {
    const q = query.trim()
    if (!q) {
      setCypherInfo({ text: 'Query is empty — type or paste Cypher.' })
      return
    }
    // Utilities rules everything (§3): the allowlist rides along on every search
    const { types, hiddenBands } = visibleNodeTypes(entityTypes)
    setCypherBusy(true)
    setCypherInfo(null)
    try {
      const payload = await runCypherQuery(q, types, hiddenBands)
      onCypherResults && onCypherResults(payload, q)
      closeCypher() // clean run → chip off, box refreshed
    } catch (err) {
      const msg = String((err && err.message) || err).replace(/^API \/cypher failed: /, '')
      setCypherInfo({ text: msg || 'Query failed — check the syntax.' })
    } finally {
      setCypherBusy(false)
    }
  }

  const onBarKeyDown = (e) => {
    if (e.key !== 'Enter') return
    if (cypherMode) {
      e.preventDefault() // no newline in the textarea — Enter runs
      runCypher()
      return
    }
    runSearch()
  }

  return (
    <div className="command-bar">
      <div className="brand">
        Frontal Lobe<span className="tm">™</span>
      </div>
      <div className="search-wrap">
        {cypherMode ? (
          <textarea
            ref={barRef}
            className="search cypher-entry"
            rows={2}
            spellCheck={false}
            placeholder="MATCH (n:CONTRACT) … — type or paste Cypher"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onBarKeyDown}
          />
        ) : (
          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Semantic search — contracts, entities, CIK…"
            onKeyDown={onBarKeyDown}
          />
        )}
        <button
          className={`cypher-chip${cypherMode ? ' on' : ''}`}
          onClick={toggleCypher}
          title={cypherMode ? 'Cypher mode on — click to return to semantic' : 'Cypher mode — structural graph search'}
        >
          Cypher
        </button>
        {cypherInfo && <div className="cypher-warn">{cypherInfo.text}</div>}
      </div>
      <div className="header-right">
        <button className={`icon-btn${logOpen ? ' active' : ''}`} title="Log — activity, jobs, KB, Cypher" onClick={onToggleLog}>
          <Scroll size={16} />
        </button>
        <button className={`icon-btn${inputOpen ? ' active' : ''}`} title="Input — companies & sources to ingest" onClick={onToggleInput}>
          <Cog size={16} />
        </button>
        <button className={`icon-btn${utilsOpen ? ' active' : ''}`} title="Utilities — graph display toggles" onClick={onToggleUtils}>
          <TableOfContents size={16} style={{ transform: 'scaleX(-1)' }} />
        </button>
      </div>

      <InputDrawer open={inputOpen} onClose={onToggleInput} />
      <UtilitiesDrawer open={utilsOpen} onClose={onToggleUtils} entityTypes={entityTypes} onEntityTypes={onEntityTypes} />
    </div>
  )
}