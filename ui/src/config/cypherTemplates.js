// ═══════════════════════════════════════════════════════════
// cypherTemplates.js — prebuilt queries for the Cypher panel
// (Beta 2.4, 16 Aug 26 · Search Wiring.md §2; consolidated 16 Aug 26).
//
// Model: ONE all-in-one template on top ("Nodes for [TICKERS]"),
// then a small set of Node→edge→Node patterns, all scoped to the
// ticker anchor. Clicking a template fills the SEARCH BAR (which
// becomes a 2-line expanding textarea in Cypher mode); the user
// edits the bracketed spots, Enter runs it.
//
// Fill-in convention: [WORD] = a single-word bracket spot, e.g.
// [TICKERS] / [NODES]. Values are comma-separated and forgiving —
// the queries trim + uppercase them (split/trim/toUpper), so
// "ionq, rgtI" works.
//
// Each template has an optional subsQuery: the same query re-anchored
// on the ticker PLUS its subsidiaries (SUBSIDIARY_OF). The panel's
// "incl. Subs" checkbox picks which form a click pastes.
//
// All templates are read-only (the endpoint blocks writes anyway).
// ═══════════════════════════════════════════════════════════

// TICKERS fill-in — comma-separated, case-insensitive.
// NODES fill-in — comma-separated node types, case-insensitive.
const TICKERS_IN = `[x IN split('[TICKERS]', ',') | toUpper(trim(x))]`
const NODES_IN = `[x IN split('[NODES]', ',') | toUpper(trim(x))]`

// The leg edges out of a TICKER (and SUBSIDIARY): contracts, deals,
// patents (+portfolio), federal awards (+portfolio). This is the
// "any leg" arm of the all-in-one template.
const LEG_EDGES =
  'HAS_CONTRACT|HAS_DEAL|HAS_PATENT|HAS_PATENT_INVENTORY|HAS_AWARD|HAS_AWARD_INVENTORY'

// Re-anchor `t` on the ticker(s) PLUS their subsidiaries. Used as the
// preamble of every subsQuery; the rest of the query is unchanged.
const SUBS_PREAMBLE = `MATCH (t:TICKER) WHERE t.ticker IN ${TICKERS_IN}
OPTIONAL MATCH (t)<-[:SUBSIDIARY_OF]-(s:SUBSIDIARY)
WITH collect(DISTINCT t) + collect(DISTINCT s) AS anchors
UNWIND anchors AS t`

export const CYPHER_TEMPLATES = [
  {
    label: 'Nodes for [TICKERS] — any leg, pick the [NODES]',
    desc: "Find all nodes of the types you list (e.g. CONTRACT, PATENT) attached to the tickers you list (e.g. IONQ, RGTI) by any leg — contract, deal, patent, or award.",
    hint: 'comma-separated: e.g. IONQ, RGTI · CONTRACT, PATENT, FEDERAL_AWARD',
    query: `MATCH (t:TICKER) WHERE t.ticker IN ${TICKERS_IN}
MATCH (t)-[:${LEG_EDGES}]->(n)
WHERE any(l IN ${NODES_IN} WHERE l IN labels(n))
RETURN DISTINCT n`,
    subsQuery: `${SUBS_PREAMBLE}
MATCH (t)-[:${LEG_EDGES}]->(n)
WHERE any(l IN ${NODES_IN} WHERE l IN labels(n))
RETURN DISTINCT n`,
  },
  {
    label: 'Patent → LEVERAGES_TECH → Technology — for [TICKERS]',
    desc: "Find the technologies the tickers' patents leverage.",
    query: `MATCH (t:TICKER) WHERE t.ticker IN ${TICKERS_IN}
MATCH (t)-[:HAS_PATENT]->(p:PATENT)-[:LEVERAGES_TECH]->(tech:TECHNOLOGY)
RETURN DISTINCT tech`,
    subsQuery: `${SUBS_PREAMBLE}
MATCH (t)-[:HAS_PATENT]->(p:PATENT)-[:LEVERAGES_TECH]->(tech:TECHNOLOGY)
RETURN DISTINCT tech`,
  },
  {
    label: 'Contract → HAS_TERM → Terms — for [TICKERS]',
    desc: "Find the terms inside the tickers' contracts — money, exclusivity, restrictions.",
    query: `MATCH (t:TICKER) WHERE t.ticker IN ${TICKERS_IN}
MATCH (t)-[:HAS_CONTRACT]->(c:CONTRACT)-[:HAS_TERM]->(tm:CONTRACT_TERM)
RETURN DISTINCT tm`,
    subsQuery: `${SUBS_PREAMBLE}
MATCH (t)-[:HAS_CONTRACT]->(c:CONTRACT)-[:HAS_TERM]->(tm:CONTRACT_TERM)
RETURN DISTINCT tm`,
  },
  {
    label: 'Federal Award → AWARDED_BY → Prime Company — for [TICKERS]',
    desc: "Find the prime companies behind the tickers' federal awards.",
    query: `MATCH (t:TICKER) WHERE t.ticker IN ${TICKERS_IN}
MATCH (t)-[:HAS_AWARD]->(a:FEDERAL_AWARD)-[:AWARDED_BY]->(co:COMPANY)
RETURN DISTINCT co`,
    subsQuery: `${SUBS_PREAMBLE}
MATCH (t)-[:HAS_AWARD]->(a:FEDERAL_AWARD)-[:AWARDED_BY]->(co:COMPANY)
RETURN DISTINCT co`,
  },
  {
    label: 'Patent → INVENTED_BY → Inventor — for [TICKERS]',
    desc: "Find the named inventors on the tickers' patents.",
    query: `MATCH (t:TICKER) WHERE t.ticker IN ${TICKERS_IN}
MATCH (t)-[:HAS_PATENT]->(p:PATENT)-[:INVENTED_BY]->(i:INVENTOR)
RETURN DISTINCT i`,
    subsQuery: `${SUBS_PREAMBLE}
MATCH (t)-[:HAS_PATENT]->(p:PATENT)-[:INVENTED_BY]->(i:INVENTOR)
RETURN DISTINCT i`,
  },
  {
    label: 'Contract Terms → action verb → Entity — for [TICKERS]',
    desc: "Find what the tickers' contract terms touch — grants, restrictions, purchases, sales, ownership, pledges, obligations.",
    hint: 'verbs: GRANTS / RESTRICTS / BUYS / SELLS / OWNS / PLEDGES / OBLIGATES',
    query: `MATCH (t:TICKER) WHERE t.ticker IN ${TICKERS_IN}
MATCH (t)-[:HAS_CONTRACT]->(c:CONTRACT)-[:HAS_TERM]->(tm:CONTRACT_TERM)-[:GRANTS|RESTRICTS|BUYS|SELLS|OWNS|PLEDGES|OBLIGATES]->(n)
RETURN DISTINCT n`,
    subsQuery: `${SUBS_PREAMBLE}
MATCH (t)-[:HAS_CONTRACT]->(c:CONTRACT)-[:HAS_TERM]->(tm:CONTRACT_TERM)-[:GRANTS|RESTRICTS|BUYS|SELLS|OWNS|PLEDGES|OBLIGATES]->(n)
RETURN DISTINCT n`,
  },
]

// ── the reference footer (bottom of the panel scroll box) ──
// Node labels (schema.py ENTITY_TYPES + COGNITION reserved for Marlowe).
export const NODE_REFERENCE = [
  'TICKER', 'SUBSIDIARY', 'COMPANY', 'PERSON',
  'CONTRACT', 'DEAL_EVENT', 'CONTRACT_TERM',
  'PRODUCT', 'TECHNOLOGY', 'IP',
  'PATENT', 'PATENT_INVENTORY', 'INVENTOR',
  'FEDERAL_AWARD', 'AWARD_INVENTORY', 'COGNITION',
]

// Relationship types (schema.py RELATION_TYPES + the evidence edge MENTIONS).
export const EDGE_REFERENCE = [
  'HAS_CONTRACT', 'HAS_DEAL', 'HAS_PATENT', 'HAS_PATENT_INVENTORY',
  'HAS_AWARD', 'HAS_AWARD_INVENTORY', 'SUBSIDIARY_OF',
  'HAS_TERM', 'COVERS',
  'GRANTS', 'RESTRICTS', 'BUYS', 'SELLS', 'OWNS', 'PLEDGES', 'OBLIGATES',
  'INVENTED_BY', 'LEVERAGES_TECH', 'AWARDED_BY', 'MENTIONS',
]
