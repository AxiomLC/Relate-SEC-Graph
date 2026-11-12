# ══════════════════════════════════════════════════════════════
# read_api.py — the read functions, vendored from the mature app.
#
# The private repo reuses `frontal-lobe/api/app/graph.py` via a sibling
# import. The public repo must be self-contained, so the read half of
# that module lives here, unchanged in behavior, running through
# api/mgapp/storage.py instead of the neo4j driver.
#
# Vendored: get_stats, get_ticker_meta_list, get_kb, export_graph,
# get_graph, get_node_detail, and the map-shaping helpers they use.
# NOT vendored: restore_graph (a write) — public is read-only.
# ══════════════════════════════════════════════════════════════
import re
from datetime import datetime, timezone

from mgapp import storage

# The session context manager (was `_driver_session` in the mature app).
_driver_session = storage.session

CANONICAL_SUFFIXES = [
    "corp", "corporation", "inc", "incorporated", "llc", "ltd", "limited",
    "co", "company", "plc", "gmbh", "ag", "sa",
]

# ── 3D-map shaping constants (from app/graph.py) ──
_GRAPH_NODE_PRIORITY = {
    "COGNITION": 1,
    "TICKER": 2,
    "SUBSIDIARY": 3,
    "COMPANY": 4,
    "CONTRACT": 4,
    "DEAL_EVENT": 4,
    "PRODUCT": 4,
    "TECHNOLOGY": 4,
    "PATENT": 4,
    "PATENT_INVENTORY": 4,
    "FEDERAL_AWARD": 4,
    "AWARD_INVENTORY": 4,
    "CONTRACT_TERM": 5,
    "FINANCIAL_TERMS": 5,
    "EXCLUSIVITY_CLAUSE": 5,
    "GEOGRAPHIC_REGION": 5,
    "INVENTOR": 5,
}
_GRAPH_ICON = {
    "COMPANY": "Building2",
    "CONTRACT": "ScrollText",
    "PRODUCT": "Package",
    "TECHNOLOGY": "CircuitBoard",
    "CONTRACT_TERM": "DollarSign",
    "FINANCIAL_TERMS": "DollarSign",
    "EXCLUSIVITY_CLAUSE": "ShieldAlert",
    "GEOGRAPHIC_REGION": "MapPin",
    "PATENT": "FileBadge",
    "PATENT_INVENTORY": "Files",
    "FEDERAL_AWARD": "BadgeDollarSign",
    "AWARD_INVENTORY": "Database",
    "INVENTOR": "User",
    "COGNITION": "Sparkles",
}
_GRAPH_MAX_NODES = 2000
_HIDDEN_LABELS = {"Chunk", "TickerMeta"}


def _canonical_name(name: str) -> str:
    """Normalize an entity name for dedup (see app/graph.py for the rationale)."""
    nm = (name or "").strip()
    m = re.match(r"^(.*?)\s*\(([^()]*)\)\s*$", nm)
    if m:
        alias = m.group(2).strip()
        is_alias = len(alias) >= 2 and ("-" in alias or "/" in alias)
        if is_alias and len(m.group(1).split()) >= 2:
            nm = m.group(1)
    words = [w for w in re.sub(r"[^a-z0-9 ]", " ", nm.strip().lower()).split() if w]
    if 1 < len(words) <= 3 and words[-1] in CANONICAL_SUFFIXES:
        words = words[:-1]
    return " ".join(words)


def ping_neo4j() -> bool:
    """Real Cypher round-trip — used by /health."""
    try:
        with _driver_session() as session:
            session.run("RETURN 1").single()
        return True
    except Exception:  # noqa: BLE001
        return False


# ===============  2. Read endpoints  ===============
def get_stats():
    """Entity/edge counts for UI telemetry."""
    with _driver_session() as session:
        nodes_row = session.run("MATCH (n:__Entity__) RETURN count(n) AS c").single()
        chunks_row = session.run("MATCH (n:Chunk) RETURN count(n) AS c").single()
        edges_row = session.run("MATCH ()-[r]->() RETURN count(r) AS c").single()
        nodes = nodes_row["c"] if nodes_row else 0
        chunks = chunks_row["c"] if chunks_row else 0
        edges = edges_row["c"] if edges_row else 0
    return {"nodes": int(nodes), "chunks": int(chunks), "edges": int(edges)}


def get_ticker_meta_list() -> list[dict]:
    """All ticker ingest records, newest run first — feeds the Input drawer."""
    with _driver_session() as session:
        return [
            dict(r)
            for r in session.run(
                "MATCH (t:TickerMeta) RETURN t.ticker AS ticker, "
                "t.last_run_at AS last_run_at, "
                "t.extraction_version AS extraction_version, "
                "t.company_name AS company_name, "
                "t.accessions AS accessions, "
                "t.contract_count AS contract_count "
                "ORDER BY t.last_run_at DESC"
            )
        ]


def _pick_exhibit(exts: list, forms: list) -> tuple[str | None, str | None]:
    """Prefer the material contract (EX-10*) over subsidiary-list exhibits."""
    if not exts:
        return None, None
    for i, e in enumerate(exts):
        if e.startswith("EX-10"):
            return e, (forms[i] if i < len(forms) else None)
    return exts[0], (forms[0] if forms else None)


def get_kb():
    """Knowledge-base dashboard: overall counts + per-ticker specs + filings."""
    with _driver_session() as session:
        nodes_row = session.run("MATCH (n:__Entity__) RETURN count(n) AS c").single()
        chunks_row = session.run("MATCH (n:Chunk) RETURN count(n) AS c").single()
        edges_row = session.run("MATCH ()-[r]->() RETURN count(r) AS c").single()
        entities = [
            dict(r)
            for r in session.run(
                "MATCH (n:__Entity__) "
                "WITH n, [l IN labels(n) WHERE NOT l STARTS WITH '__'] AS typed "
                "UNWIND typed AS t "
                "RETURN t AS type, count(*) AS count ORDER BY count DESC"
            )
        ]
        rels = [
            dict(r)
            for r in session.run(
                "MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count ORDER BY count DESC"
            )
        ]
        filings = [
            dict(r)
            for r in session.run(
                "MATCH (n) WHERE n.accession_number IS NOT NULL "
                "WITH n.accession_number AS accession, "
                "[c IN collect(DISTINCT n.company_name) WHERE c IS NOT NULL] AS cos, "
                "[d IN collect(DISTINCT n.filing_date) WHERE d IS NOT NULL] AS dates, "
                "[e IN collect(DISTINCT n.exhibit_type) WHERE e IS NOT NULL] AS exts, "
                "[f IN collect(DISTINCT n.source_form) WHERE f IS NOT NULL] AS forms "
                "RETURN accession, head(cos) AS company, head(dates) AS filing_date, exts, forms "
                "ORDER BY filing_date DESC"
            )
        ]
        for f in filings:
            exts, forms = f.pop("exts"), f.pop("forms")
            f["exhibit_type"], f["source_form"] = _pick_exhibit(exts, forms)
        ticker_rows = [
            dict(t["t"]) for t in session.run("MATCH (t:TickerMeta) RETURN t").data()
        ]

        ticker_agg = {
            r["ticker"]: r
            for r in session.run(
                "MATCH (t:TickerMeta) "
                "CALL { WITH t MATCH (n:__Entity__) "
                "      WHERE n.ticker = t.ticker RETURN count(n) AS nodes } "
                "CALL { WITH t MATCH (n:Chunk) "
                "      WHERE n.ticker = t.ticker RETURN count(n) AS chunks } "
                "CALL { WITH t MATCH (a)-[r]->(b) "
                "      WHERE a.ticker = t.ticker OR b.ticker = t.ticker RETURN count(r) AS edges } "
                "CALL { WITH t MATCH (n) "
                "      WHERE n.ticker = t.ticker AND n.id STARTS WITH 'subsidiary:' RETURN count(n) AS subs } "
                "RETURN t.ticker AS ticker, nodes, chunks, edges, subs"
            ).data()
        }
        all_accs = [a for info in ticker_rows for a in (info.get("accessions") or [])]
        contract_by_acc = {}
        if all_accs:
            contract_by_acc = {
                r["accession"]: dict(r)
                for r in session.run(
                    "MATCH (n) WHERE n.accession_number IN $accs AND n.exhibit_type IS NOT NULL "
                    "RETURN n.accession_number AS accession, n.filing_date AS filing_date, "
                    "n.exhibit_type AS exhibit_type, n.source_form AS source_form",
                    accs=all_accs,
                ).data()
            }

        tk_list = [info.get("ticker", "") for info in ticker_rows]
        top_awards = {}
        for r in session.run(
            "MATCH (a:FEDERAL_AWARD) WHERE a.ticker IN $tk AND a.amount IS NOT NULL "
            "RETURN a.ticker AS ticker, a.name AS name, a.amount AS amount, "
            "a.period_start AS period ORDER BY a.amount DESC",
            tk=tk_list,
        ):
            d = dict(r)
            top_awards.setdefault(d["ticker"], d)
        top_terms = {}
        for r in session.run(
            "MATCH (x:CONTRACT_TERM) WHERE x.ticker IN $tk AND x.amount IS NOT NULL "
            "RETURN x.ticker AS ticker, x.name AS name, x.amount AS amount "
            "ORDER BY x.amount DESC",
            tk=tk_list,
        ):
            d = dict(r)
            top_terms.setdefault(d["ticker"], d)
        active_subs = {}
        for r in session.run(
            "MATCH (s:SUBSIDIARY) WHERE s.ticker IN $tk "
            "MATCH (s)-[e]-(x:__Entity__) WHERE NOT x:SUBSIDIARY "
            "RETURN s.ticker AS ticker, s.name AS name, count(e) AS deg ORDER BY deg DESC",
            tk=tk_list,
        ):
            d = dict(r)
            active_subs.setdefault(d["ticker"], []).append(d)
        products_by = {}
        for r in session.run(
            "MATCH (n:PRODUCT) WHERE n.ticker IN $tk "
            "RETURN n.ticker AS ticker, n.name AS name ORDER BY n.name",
            tk=tk_list,
        ):
            products_by.setdefault(r["ticker"], []).append(r["name"])
        techs_by = {}
        for r in session.run(
            "MATCH (n:TECHNOLOGY) WHERE n.ticker IN $tk "
            "RETURN n.ticker AS ticker, n.name AS name ORDER BY n.name",
            tk=tk_list,
        ):
            techs_by.setdefault(r["ticker"], []).append(r["name"])
        patent_counts = {}
        for r in session.run(
            "MATCH (n:PATENT) WHERE n.ticker IN $tk RETURN n.ticker AS ticker, count(*) AS c",
            tk=tk_list,
        ):
            patent_counts[r["ticker"]] = int(r["c"])
        app_counts = {}
        for r in session.run(
            "MATCH (n:PATENT_INVENTORY) WHERE n.ticker IN $tk "
            "RETURN n.ticker AS ticker, n.app_count AS c",
            tk=tk_list,
        ):
            app_counts[r["ticker"]] = int(r["c"] or 0)
        award_counts = {}
        for r in session.run(
            "MATCH (a:FEDERAL_AWARD) WHERE a.ticker IN $tk RETURN a.ticker AS ticker, count(*) AS c",
            tk=tk_list,
        ):
            award_counts[r["ticker"]] = int(r["c"])
        award_inv = {}
        for r in session.run(
            "MATCH (n:AWARD_INVENTORY) WHERE n.ticker IN $tk "
            "RETURN n.ticker AS ticker, n.award_count AS c",
            tk=tk_list,
        ):
            award_inv[r["ticker"]] = int(r["c"] or 0)
        contract_counts = {}
        for r in session.run(
            "MATCH (c:CONTRACT) WHERE c.ticker IN $tk "
            "OPTIONAL MATCH (c)-[:HAS_TERM]->(x:CONTRACT_TERM) "
            "RETURN c.ticker AS ticker, c.name AS name, c.filing_date AS fd, count(x) AS terms "
            "ORDER BY terms DESC",
            tk=tk_list,
        ):
            d = dict(r)
            contract_counts.setdefault(d["ticker"], []).append(d)
        unique_connections = [
            dict(r)
            for r in session.run(
                "MATCH (a)-[r]-(b) WHERE a.ticker IS NOT NULL AND b.ticker IS NOT NULL "
                "AND a.ticker <> b.ticker AND NOT a:SUBSIDIARY AND NOT b:SUBSIDIARY "
                "AND NOT a:TICKER AND NOT b:TICKER AND NOT a:Chunk AND NOT b:Chunk "
                "AND NOT a:CONTRACT_TERM AND NOT b:CONTRACT_TERM "
                "WITH a, collect(DISTINCT b.ticker) AS clusters, count(r) AS links "
                "RETURN labels(a)[-1] AS type, a.name AS name, a.ticker AS own, "
                "[a.ticker] + clusters AS bridges, links "
                "ORDER BY links DESC LIMIT 10"
            )
        ]
        size_row = session.run(
            "MATCH (n) WHERE n:Chunk OR n:__Entity__ "
            "RETURN sum(size(n.text)) + sum(size(n.summary)) + sum(size(n.name)) AS bytes"
        ).single()
        updated_row = session.run(
            "MATCH (t:TickerMeta) RETURN max(t.last_run_at) AS last"
        ).single()
        updated_at = None
        if updated_row and updated_row["last"] is not None:
            try:
                updated_at = updated_row["last"].isoformat()
            except AttributeError:
                updated_at = str(updated_row["last"])

    tickers = []
    for info in ticker_rows:
        tkr = info.get("ticker", "")
        contract = None
        for acc in info.get("accessions") or []:
            if acc in contract_by_acc:
                contract = contract_by_acc[acc]
                break
        agg = ticker_agg.get(tkr, {})
        info["nodes"] = int(agg.get("nodes") or 0)
        info["chunks"] = int(agg.get("chunks") or 0)
        info["edges"] = int(agg.get("edges") or 0)
        info["subsidiaries"] = int(agg.get("subs") or 0)
        info["contract"] = contract
        info["canonical"] = _canonical_name(info.get("company_name") or "")
        info["top_award"] = top_awards.get(tkr)
        info["top_term"] = top_terms.get(tkr)
        info["active_subs"] = active_subs.get(tkr, [])[:3]
        info["products"] = products_by.get(tkr, [])[:5]
        info["techs"] = techs_by.get(tkr, [])[:5]
        info["patents"] = patent_counts.get(tkr, 0)
        info["patent_inventory"] = app_counts.get(tkr, 0)
        info["contracts"] = len(contract_counts.get(tkr, []))
        info["top_contract"] = (contract_counts.get(tkr) or [{}])[0]
        info["awards"] = award_counts.get(tkr, 0)
        info["award_inventory"] = award_inv.get(tkr, 0)
        tickers.append(info)

    return {
        "nodes": int(nodes_row["c"]) if nodes_row else 0,
        "chunks": int(chunks_row["c"]) if chunks_row else 0,
        "edges": int(edges_row["c"]) if edges_row else 0,
        "entities": entities,
        "relationships": rels,
        "filings": filings,
        "tickers": tickers,
        "size_mb": round(int((size_row["bytes"] if size_row else 0) or 0) / 1e6, 1),
        "updated_at": updated_at,
        "unique_connections": unique_connections,
    }


# ===============  3. Export (backup)  ===============
def export_graph(lean: bool = False) -> dict:
    """Graph snapshot as JSON. lean=True strips every embedding vector."""
    with _driver_session() as session:
        nodes = []
        for r in session.run(
            "MATCH (n) RETURN elementId(n) AS eid, labels(n) AS labels, properties(n) AS properties"
        ):
            props = dict(r["properties"])
            if lean:
                props.pop("embedding", None)
            key = props.get("id") or props.get("ticker") or r["eid"]
            nodes.append(
                {"key": key, "labels": sorted(r["labels"]), "properties": props}
            )
        rels = [
            dict(r)
            for r in session.run(
                "MATCH (a)-[r]->(b) "
                "RETURN type(r) AS type, coalesce(a.id, a.ticker) AS start, "
                "coalesce(b.id, b.ticker) AS end, properties(r) AS properties"
            )
        ]
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "app": "frontal-lobe",
        "lean": lean,
        "counts": {"nodes": len(nodes), "relationships": len(rels)},
        "nodes": nodes,
        "relationships": rels,
    }


# ===============  4. 3D-map shaping  ===============
def _primary_type(labels: list[str]) -> str:
    """The map-facing type of a node: first known entity type among its labels."""
    for t in _GRAPH_NODE_PRIORITY:
        if t in labels:
            return t
    return next(
        (l for l in labels if not l.startswith("__") and l not in _HIDDEN_LABELS),
        "ENTITY",
    )


def _scope_node_ids(session, tickers: list[str] | None) -> set:
    """Ticker-scoped entity ids + their 1-hop typed neighbors."""
    if tickers:
        anchors = [
            r["id"]
            for r in session.run(
                "MATCH (n:__Entity__) WHERE n.ticker IN $ts RETURN n.id AS id",
                ts=tickers,
            )
        ]
    else:
        anchors = [
            r["id"] for r in session.run("MATCH (n:__Entity__) RETURN n.id AS id")
        ]
    if not anchors:
        return set()
    neighbors = [
        r["id"]
        for r in session.run(
            "MATCH (a:__Entity__)-[e]-(b:__Entity__) "
            "WHERE a.id IN $ids AND NOT type(e) = 'MENTIONS' RETURN DISTINCT b.id AS id",
            ids=anchors,
        )
    ]
    return set(anchors) | set(neighbors)


def _ego_node_ids(session, node: str, hops: int) -> set:
    """Ego-mode ids: the node + up to `hops` hops via typed (non-MENTIONS) edges."""
    seen: set[str] = {node}
    frontier = [node]
    for _ in range(max(1, min(3, hops))):
        if not frontier:
            break
        nxt = [
            r["id"]
            for r in session.run(
                "MATCH (a:__Entity__)-[e]-(b:__Entity__) "
                "WHERE a.id IN $fr AND NOT type(e) = 'MENTIONS' RETURN DISTINCT b.id AS id",
                fr=frontier,
            )
        ]
        frontier = [x for x in nxt if x not in seen]
        seen.update(frontier)
    return seen


def _cap_by_priority(session, ids: set) -> list:
    """Hard cap with tier priority (tiers first) when the scope exceeds the cap."""
    if len(ids) <= _GRAPH_MAX_NODES:
        return list(ids)
    rows = list(
        session.run(
            "MATCH (n:__Entity__) WHERE n.id IN $ids RETURN n.id AS id, labels(n) AS labels",
            ids=list(ids),
        )
    )
    rows.sort(key=lambda r: _GRAPH_NODE_PRIORITY.get(_primary_type(r["labels"]), 6))
    return [r["id"] for r in rows[:_GRAPH_MAX_NODES]]


def _clean_jurisdiction(jur: str) -> str:
    """Display-clean a jurisdiction string for captions."""
    if not jur:
        return jur
    s = re.sub(r"\bLimited Liability Company\b", "LLC", jur.strip(), flags=re.IGNORECASE)
    s = re.sub(r"\bincorporated in\b", "inc in", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(?:organized|formed|constituted)\s+under the laws?\s+of\s+(?:the\s+)?", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", " ", s)
    return s.strip(" ,")


def _graph_node(props: dict, labels: list[str]) -> dict:
    """One map node in the /graph data contract {id, label, caption, tier, type, icon}."""
    ntype = _primary_type(labels)
    caption = None
    if ntype == "SUBSIDIARY":
        jur = _clean_jurisdiction(props.get("jurisdiction") or "")
        caption = f"Subs- {jur}" if jur else "Subs-"
    elif ntype == "COMPANY":
        caption = _clean_jurisdiction(props.get("jurisdiction") or "") or None
    elif ntype == "TICKER":
        caption = props.get("ticker") or props.get("company_name")
    elif ntype == "CONTRACT":
        form = props.get("source_form") or ""
        ex = props.get("exhibit_type") or ""
        caption = f"{form}-{ex}" if form and ex else (form or ex or None)
    elif ntype == "PATENT":
        t = props.get("ticker")
        caption = f"PATENT: {t}" if t else (
            props.get("patent_number") or props.get("publication_number") or None
        )
    elif ntype == "PATENT_INVENTORY":
        n = props.get("app_count")
        caption = f"{n} apps" if n else "pipeline"
    elif ntype == "FEDERAL_AWARD":
        amt = props.get("amount")
        amt_s = (
            f"${amt / 1_000_000_000:.1f}B" if amt and amt >= 1_000_000_000
            else f"${amt / 1_000_000:.1f}M" if amt and amt >= 1_000_000
            else f"${amt:,.0f}" if amt else ""
        )
        abbr = props.get("agency_abbrev") or ""
        base = f"{abbr} · {amt_s}" if abbr and amt_s else (abbr or amt_s or None)
        caption = f"SUB {base}" if props.get("role") == "subcontract" and base else base
    elif ntype == "AWARD_INVENTORY":
        n = props.get("award_count")
        caption = f"{n} awards" if n else "pipeline"
    elif ntype == "INVENTOR":
        caption = "Inventor"
    elif ntype == "TECHNOLOGY":
        caption = "Tech"
    elif ntype == "DEAL_EVENT":
        caption = "Deal"
    elif ntype == "CONTRACT_TERM":
        amt = props.get("amount")
        amt_s = (
            f"${amt / 1_000_000_000:.1f}B" if amt and amt >= 1_000_000_000
            else f"${amt / 1_000_000:.1f}M" if amt and amt >= 1_000_000
            else f"${amt:,.0f}" if amt is not None else ""
        )
        rate = props.get("rate")
        rate_s = f"{rate}%" if rate is not None else ""
        mat = props.get("maturity") or props.get("date")
        mat_s = str(mat) if mat else ""
        bits = [b for b in (amt_s, rate_s, mat_s) if b]
        caption = " · ".join(bits) if bits else None
    return {
        "id": props.get("id"),
        "label": props.get("name") or props.get("id"),
        "caption": caption,
        "tier": _GRAPH_NODE_PRIORITY.get(ntype, 5),
        "type": ntype,
        "icon": _GRAPH_ICON.get(ntype),
        "ticker": props.get("ticker"),
        "summary": props.get("summary"),
        "contract_score": props.get("contract_score"),
        "contract_band": props.get("contract_band"),
    }


def get_graph(
    tickers: list[str] | None = None, node: str | None = None, hops: int = 1
) -> dict:
    """Ticker-scoped subgraph for the 3D map (entities only)."""
    with _driver_session() as session:
        ids = (
            _ego_node_ids(session, node, hops)
            if node
            else _scope_node_ids(session, tickers)
        )
        if not ids:
            return {"nodes": [], "links": []}
        ids = _cap_by_priority(session, ids)
        nodes = [
            _graph_node(
                {
                    k: r[k]
                    for k in (
                        "id", "name", "ticker", "jurisdiction", "company_name",
                        "source_form", "exhibit_type", "contract_seq",
                        "contract_score", "contract_band", "patent_number",
                        "publication_number", "app_count", "summary", "amount",
                        "agency_abbrev", "kind", "role", "award_count",
                    )
                },
                r["labels"],
            )
            for r in session.run(
                "MATCH (n:__Entity__) WHERE n.id IN $ids "
                "RETURN n.id AS id, n.name AS name, n.ticker AS ticker, "
                "n.jurisdiction AS jurisdiction, n.company_name AS company_name, "
                "n.source_form AS source_form, n.exhibit_type AS exhibit_type, "
                "n.contract_seq AS contract_seq, "
                "n.contract_score AS contract_score, "
                "n.contract_band AS contract_band, "
                "n.patent_number AS patent_number, "
                "n.publication_number AS publication_number, "
                "n.app_count AS app_count, "
                "n.amount AS amount, "
                "n.agency_abbrev AS agency_abbrev, "
                "n.kind AS kind, "
                "n.role AS role, "
                "n.award_count AS award_count, "
                "n.summary AS summary, labels(n) AS labels",
                ids=ids,
            )
        ]
        links = [
            {"source": r["s"], "target": r["t"], "type": r["type"], "weight": 1}
            for r in session.run(
                "MATCH (a:__Entity__)-[e]->(b:__Entity__) "
                "WHERE a.id IN $ids AND b.id IN $ids "
                "AND NOT type(e) IN ['MENTIONS', 'IN_JURISDICTION'] "
                "RETURN a.id AS s, b.id AS t, type(e) AS type",
                ids=ids,
            )
        ]
        geo_ids = {n["id"] for n in nodes if n["type"] == "GEOGRAPHIC_REGION"}
        nodes = [n for n in nodes if n["id"] not in geo_ids]
        links = [
            l for l in links
            if l["source"] not in geo_ids and l["target"] not in geo_ids
        ]
        # No visible islands: every rendered node must trace back to a TICKER.
        type_by_id = {n["id"]: n["type"] for n in nodes}
        adj: dict[str, set[str]] = {}
        for l in links:
            adj.setdefault(l["source"], set()).add(l["target"])
            adj.setdefault(l["target"], set()).add(l["source"])
        seen: set[str] = set()
        keep: set[str] = set()
        for nid in type_by_id:
            if nid in seen:
                continue
            comp: list[str] = []
            stack = [nid]
            seen.add(nid)
            while stack:
                x = stack.pop()
                comp.append(x)
                for y in adj.get(x, ()):
                    if y not in seen:
                        seen.add(y)
                        stack.append(y)
            anchored = (
                (node in comp)
                if node
                else any(type_by_id.get(x) == "TICKER" for x in comp)
            )
            if anchored:
                keep.update(comp)
        nodes = [n for n in nodes if n["id"] in keep]
        links = [l for l in links if l["source"] in keep and l["target"] in keep]
    return {"nodes": nodes, "links": links}


def get_node_detail(node_id: str) -> dict:
    """Viewer payload for one node: summary + source chunks + 1-hop neighbors."""
    with _driver_session() as session:
        row = session.run(
            "MATCH (n) WHERE n.id = $id "
            "RETURN n.summary AS summary, n.ticker AS ticker, labels(n) AS labels, "
            "n.accession_number AS acc, n.exhibit_type AS ex, n.source_form AS form, "
            "n.filing_date AS fd, n.patent_number AS pnum, n.application_number AS appnum, "
            "n.status AS status, n.grant_date AS gd, n.cpc AS cpc, n.importance AS imp, "
            "n.app_count AS app_count, "
            "n.piid AS piid, n.kind AS kind, n.amount AS amount, "
            "n.rate AS rate, n.maturity AS maturity, "
            "n.agency_toptier AS agency_toptier, n.agency_subtier AS agency_subtier, "
            "n.agency_office AS agency_office, n.period_start AS period_start, "
            "n.period_end AS period_end, n.recipient_name AS recipient_name, "
            "n.recipient_uei AS recipient_uei, "
            "n.role AS role, n.sub_award_id AS sub_award_id, "
            "n.prime_piid AS prime_piid, n.prime_recipient AS prime_recipient, "
            "n.prime_recipient_uei AS prime_recipient_uei",
            id=node_id,
        ).single()
        if not row:
            return {
                "id": node_id, "summary": None, "ticker": None,
                "meta": {}, "chunks": [], "neighbors": [],
            }
        meta = {
            "accession": row["acc"], "exhibit": row["ex"], "form": row["form"],
            "filing_date": row["fd"], "patent_number": row["pnum"],
            "application_number": row["appnum"], "status": row["status"],
            "grant_date": row["gd"], "cpc": row["cpc"], "importance": row["imp"],
            "app_count": row["app_count"], "piid": row["piid"], "kind": row["kind"],
            "amount": row["amount"], "rate": row["rate"], "maturity": row["maturity"],
            "agency_toptier": row["agency_toptier"],
            "agency_subtier": row["agency_subtier"],
            "agency_office": row["agency_office"],
            "period_start": row["period_start"], "period_end": row["period_end"],
            "recipient_name": row["recipient_name"],
            "recipient_uei": row["recipient_uei"], "role": row["role"],
            "sub_award_id": row["sub_award_id"], "prime_piid": row["prime_piid"],
            "prime_recipient": row["prime_recipient"],
            "prime_recipient_uei": row["prime_recipient_uei"],
        }
        chunks = [
            {
                "index": r["i"] if r["i"] is not None else 0,
                "text": r["text"],
                "section_title": r.get("section"),
            }
            for r in session.run(
                "MATCH (n)-[:MENTIONS]-(c) WHERE n.id = $id AND c.text IS NOT NULL "
                "RETURN c.chunk_index AS i, c.text AS text, c.section_title AS section "
                "ORDER BY coalesce(c.chunk_index, 0) LIMIT 200",
                id=node_id,
            )
        ]
        neighbors = [
            {
                "id": r["id"], "name": r["name"],
                "type": _primary_type(r["labels"]), "edge": r["t"],
            }
            for r in session.run(
                "MATCH (n)-[e]-(m) WHERE n.id = $id AND m:__Entity__ "
                "AND NOT type(e) = 'MENTIONS' "
                "RETURN DISTINCT m.id AS id, m.name AS name, labels(m) AS labels, type(e) AS t "
                "LIMIT 40",
                id=node_id,
            )
        ]
    return {
        "id": node_id, "summary": row["summary"], "ticker": row["ticker"],
        "meta": meta, "chunks": chunks, "neighbors": neighbors,
    }
