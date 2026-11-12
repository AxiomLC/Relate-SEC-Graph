// ═══════════════════════════════════════════════════════════
// nodeTypes.js — the ONE source of truth for which node types
// the Utilities drawer toggles and what search sees (Beta 2.4,
// 16 Aug 26). Extracted from UtilitiesDrawer so the search
// layer can ride the same allowlist — "Utilities rules
// everything" (Search Wiring.md §3).
//
// Two key spaces live here:
//   TOGGLE_TYPES          — what the drawer renders. Includes the
//                           CONTRACT band pseudo-types "CONTRACT >"
//                           / "CONTRACT <" (the node's own
//                           contract_band meta picks which applies).
//                           TICKER is deliberately NOT a toggle
//                           (island rule — a hidden ticker cascades
//                           its whole cluster off the map).
//   visibleNodeTypes(...) — what SEARCH consumes: the plain
//                           node-type allowlist + hidden contract
//                           bands, derived from the SAME toggle
//                           object. The search endpoint receives
//                           this as a param on every Search, so
//                           results can never include a node the
//                           map isn't showing.
// ═══════════════════════════════════════════════════════════

// The drawer list — order = display order (SEC family, patent
// family, award family, then COGNITION reserved for Marlowe).
// TRADEMARK deliberately NOT here — the TM leg is a maybe-future;
// an unbuilt node type has no toggle (16 Aug 26).
export const TOGGLE_TYPES = [
  'COMPANY', 'SUBSIDIARY', 'CONTRACT >', 'CONTRACT <', 'DEAL_EVENT',
  'PRODUCT', 'TECHNOLOGY', 'IP', 'PERSON', 'CONTRACT_TERM',
  'PATENT', 'PATENT_INVENTORY', 'INVENTOR',
  'FEDERAL_AWARD', 'AWARD_INVENTORY', 'COGNITION',
]

// Toggle key → plain node type (only the band pseudo-types need a map;
// every other key IS its node type).
const TOGGLE_TO_TYPE = {
  'CONTRACT >': 'CONTRACT',
  'CONTRACT <': 'CONTRACT',
}

// Visibility predicate — same semantics everywhere (drawer checkbox,
// map crawl, search scoping): undefined/null entry counts as ON, so
// the all-on default needs no stored object at all.
export const typeOn = (entityTypes, t) => (entityTypes ?? {})[t] !== false

// Band predicate for a CONTRACT node (band meta: ">" juicy / "<"
// boring, stamped at ingest). A contract whose band's toggle is off
// behaves like a toggled-off type everywhere.
export const bandOn = (entityTypes, band) => {
  if (band === '>') return typeOn(entityTypes, 'CONTRACT >')
  if (band === '<') return typeOn(entityTypes, 'CONTRACT <')
  return true // no band meta — show it
}

// THE exposed point for search (Cypher endpoint + semantic mode):
//   { types: [...plain node types currently visible],
//     hiddenBands: ['<' | '>', ...] }
// The server filters results to `type IN types` and additionally
// drops CONTRACTs whose contract_band is in hiddenBands — so search
// is scoped to exactly what the visual graph shows, and every result
// row can halo on the map.
export function visibleNodeTypes(entityTypes) {
  const types = entityTypes ?? {}
  const visible = new Set()
  const hiddenBands = []
  for (const key of TOGGLE_TYPES) {
    const on = types[key] !== false
    if (key in TOGGLE_TO_TYPE) {
      const band = key.slice('CONTRACT '.length)
      if (on) visible.add(TOGGLE_TO_TYPE[key])
      else hiddenBands.push(band)
    } else if (on) {
      visible.add(key)
    }
  }
  return { types: [...visible], hiddenBands }
}
