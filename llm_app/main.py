# ══════════════════════════════════════════════════════════════
# main.py — FastAPI entry point for the PUBLIC Frontal Lobe app on Relate.
#
# Read-only. Serves the same read endpoints the UI calls, backed by a
# pre-built Relate directory store (data/graph). No ingest, no writes,
# no `app.*` imports — the read functions are vendored in read_api.py.
#
# Run:  python -m llm_app.main        (or: uvicorn llm_app.main:app --port 8020)
# ══════════════════════════════════════════════════════════════
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.encoders import ENCODERS_BY_TYPE
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from relate import Duration, Node, Temporal

# Relate returns its own Temporal/Duration objects for datetime()/duration().
# They are not JSON types and have no isoformat(); str() yields ISO 8601
# ("2026-11-13T10:15:38Z", "P1D"), which is what the UI expects. Without this,
# /tickers, /kb and /export fail to encode any node carrying a timestamp.
ENCODERS_BY_TYPE[Temporal] = str
ENCODERS_BY_TYPE[Duration] = str

# make the repo root AND api/ importable — `mgapp` lives in api/, and
# read_api imports it at module level, so this must happen before line 37.
_REPO = Path(__file__).resolve().parents[1]
_API = _REPO / "api"
for _p in (_REPO, _API):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from llm_app.call_log import call_log  # noqa: E402
from llm_app.embed import embed_query  # noqa: E402
from llm_app.events import eventlog  # noqa: E402
from llm_app.read_api import (  # noqa: E402
    _graph_node,
    _primary_type,
    export_graph,
    get_graph,
    get_kb,
    get_node_detail,
    get_ticker_meta_list,
    ping_neo4j,
)

import mgapp.storage as storage  # noqa: E402

_ = load_dotenv(_REPO / ".env", override=True)

app = FastAPI(title="Frontal Lobe - GraphRAG on Relate", version="1.0.0")

_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── request models ───────────────────────────────────────────
class CypherRequest(BaseModel):
    query: str = Field(description="Cypher query (read-only: MATCH/WHERE/RETURN)")
    types: list[str] = Field(default_factory=list)
    hidden_bands: list[str] = Field(default_factory=list)
    limit: int = Field(default=200)


class SemanticRequest(BaseModel):
    text: str = Field(description="Natural-language query")
    types: list[str] = Field(default_factory=list)
    hidden_bands: list[str] = Field(default_factory=list)
    limit: int = Field(default=20)
    top_k: int = Field(default=80)


# ── read endpoints ───────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "frontal-lobe-relate", "db": ping_neo4j()}


@app.get("/stats")
def stats():
    try:
        return storage.stats()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"relate store unreachable: {e}")


@app.get("/config")
def config():
    return {
        "extraction_version": os.getenv("EXTRACTION_VERSION", "v29"),
        "juicy_score_threshold": int(os.getenv("JUICY_SCORE_THRESHOLD", "6")),
        "boring_max_terms_per_contract": int(os.getenv("BORING_MAX_TERMS_PER_CONTRACT", "6")),
    }


@app.get("/kb")
def kb():
    try:
        return get_kb()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"relate store unreachable: {e}")


@app.get("/export")
def export_endpoint(lean: bool = False):
    try:
        return export_graph(lean=lean)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"relate store unreachable: {e}")


@app.get("/graph")
def graph(tickers: str = "", node: str = "", hops: int = 1):
    import time

    _t0 = time.perf_counter()
    try:
        tlist = (
            [t.strip().upper() for t in tickers.split(",") if t.strip()]
            if tickers
            else None
        )
        result = get_graph(tickers=tlist, node=node or None, hops=hops)
        call_log.log("graph", node or (",".join(tlist) if tlist else "all"),
                     (time.perf_counter() - _t0) * 1000, len(result.get("nodes", [])), "ui")
        return result
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"relate store unreachable: {e}")


@app.get("/node/{node_id}")
def node_detail(node_id: str):
    import time

    _t0 = time.perf_counter()
    try:
        result = get_node_detail(node_id)
        call_log.log("node", node_id, (time.perf_counter() - _t0) * 1000,
                     len(result.get("chunks", [])), "ui")
        return result
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"relate store unreachable: {e}")


@app.get("/tickers")
def tickers():
    try:
        return get_ticker_meta_list()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"relate store unreachable: {e}")


# ── search ───────────────────────────────────────────────────
_WRITE_RE = re.compile(
    r"\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|FOREACH|LOAD\s+CSV|ALTER|DROP|RENAME)\b",
    re.IGNORECASE,
)
_APOC_RE = re.compile(r"\bapoc\.", re.IGNORECASE)
_HAS_LIMIT_RE = re.compile(r"\bLIMIT\b", re.IGNORECASE)


def _json_safe(v):
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    if isinstance(v, Node):
        return dict(v)
    if isinstance(v, (list, tuple)):
        return [_json_safe(x) for x in v]
    if isinstance(v, dict):
        return {k: _json_safe(x) for k, x in v.items()}
    try:
        return str(v)
    except Exception:  # noqa: BLE001
        return None


def _clip_line(s: str, n: int = 140) -> str:
    s = (s or "").strip().replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"


@app.post("/cypher")
def cypher_search(req: CypherRequest):
    import time

    q = (req.query or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Query is empty.")
    if _WRITE_RE.search(q) or _APOC_RE.search(q):
        raise HTTPException(
            status_code=400,
            detail="Read-only search — CREATE / MERGE / DELETE / SET / apoc clauses are blocked.",
        )
    limit = max(1, min(int(req.limit or 200), 500))
    exec_q = q if _HAS_LIMIT_RE.search(q) else f"{q} LIMIT $__cap"
    _t0 = time.perf_counter()
    try:
        with storage.session(access="read") as s:
            records = list(s.run(exec_q, __cap=limit + 1))
            nodes = []
            seen = set()
            scalar = None
            for rec in records:
                if scalar is None:
                    scalar = {k: _json_safe(v) for k, v in rec.items()
                              if not isinstance(v, Node)}
                for v in rec.values():
                    if isinstance(v, Node):
                        nid = dict(v).get("id")
                        if nid and nid not in seen:
                            seen.add(nid)
                            nodes.append(v)
            rows = []
            for n in nodes[:limit]:
                props = dict(n)
                g = _graph_node(props, list(n.labels))
                rows.append({
                    "id": g["id"],
                    "element_id": g["id"],
                    "type": _primary_type(list(n.labels)),
                    "name": g["label"],
                    "caption": g["caption"],
                    "ticker": props.get("ticker"),
                    "degree": 0,
                    "meta": {k: _json_safe(v) for k, v in props.items()
                             if k not in ("id", "name", "ticker", "embedding")},
                })
            if not nodes and records:
                rows = [_json_safe(dict(r)) for r in records[:limit]]
        call_log.log("cypher", _clip_line(q), (time.perf_counter() - _t0) * 1000, len(rows), "ui")
        eventlog.emit("ok", f"▶ Cypher: {_clip_line(q)} — {len(rows)} node(s)", leg="cypher")
        return {"rows": rows, "meta": {"count": len(rows), "capped": len(nodes) > limit,
                                       "scalar": scalar if not nodes else None}}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        call_log.log("cypher", _clip_line(q), (time.perf_counter() - _t0) * 1000, 0, "ui", str(e))
        eventlog.emit("error", f"Cypher failed: {_clip_line(q)} — {e}", leg="cypher")
        raise HTTPException(status_code=503, detail=f"query engine unreachable: {e}")


@app.post("/semantic")
def semantic_search(req: SemanticRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Search text is empty.")
    limit = max(1, min(int(req.limit or 20), 50))
    import time

    _t0 = time.perf_counter()
    try:
        vec = embed_query(text)
        hits = storage.vector_search(vec, top_k=max(10, min(int(req.top_k or 80), 400)))
        if not hits:
            call_log.log("semantic", _clip_line(text), (time.perf_counter() - _t0) * 1000, 0, "ui")
            return {"rows": [], "meta": {"count": 0}}
        score_by_cid = {h["node_id"]: h["score"] for h in hits}
        with storage.session(access="read") as s:
            pairs = list(s.run(
                "MATCH (c:Chunk)-[:MENTIONS]-(e:__Entity__) "
                "WHERE c.id IN $ids RETURN c.id AS cid, e AS node",
                ids=list(score_by_cid.keys()),
            ))
        best = {}
        for p in pairs:
            node = p["node"]
            nid = dict(node).get("id")
            sc = score_by_cid.get(p["cid"], 0.0)
            if nid and (nid not in best or sc > best[nid][0]):
                best[nid] = (sc, node)
        ranked = sorted(best.items(), key=lambda kv: -kv[1][0])[:limit]
        rows = []
        for nid, (sc, node) in ranked:
            props = dict(node)
            g = _graph_node(props, list(node.labels))
            rows.append({
                "id": g["id"],
                "element_id": g["id"],
                "type": _primary_type(list(node.labels)),
                "name": g["label"],
                "caption": g["caption"],
                "ticker": props.get("ticker"),
                "degree": 0,
                "score": round(sc, 4),
                "meta": {k: _json_safe(v) for k, v in props.items()
                         if k not in ("id", "name", "ticker", "embedding")},
            })
        call_log.log("semantic", _clip_line(text), (time.perf_counter() - _t0) * 1000, len(rows), "ui")
        eventlog.emit("ok", f"▶ Semantic: {_clip_line(text)} — {len(rows)} node(s)", leg="semantic")
        return {"rows": rows, "meta": {"count": len(rows)}}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        call_log.log("semantic", _clip_line(text), (time.perf_counter() - _t0) * 1000, 0, "ui", str(e))
        eventlog.emit("error", f"Semantic failed: {_clip_line(text)} — {e}", leg="semantic")
        raise HTTPException(status_code=503, detail=f"search engine unreachable: {e}")


# ── telemetry drawers ────────────────────────────────────────
@app.get("/events")
def events(limit: int = 200):
    return eventlog.list_events(limit=max(1, min(limit, 500)))


@app.get("/mcp-calls")
def mcp_calls(limit: int = 100):
    return call_log.recent(limit=limit)


# ── read-only build: write endpoints answer, but refuse ──────
# The UI ships the full drawer set (ingest, rebuild, truncate, restore).
# This build has no ingest pipeline and a read-only store, so those panels
# get a clear 501 instead of a bare 404. The message is what the UI shows.
_READ_ONLY_DETAIL = (
    "This is the read-only public build. The graph is pre-built and shipped "
    "in data/graph/; the ingest pipeline lives in the private repo."
)


@app.get("/jobs")
def jobs():
    """No job queue here — an empty list keeps the Log drawer's Jobs tab clean."""
    return []


@app.post("/ingest")
def ingest_disabled():
    raise HTTPException(status_code=501, detail=_READ_ONLY_DETAIL)


@app.post("/ingest-patents")
def ingest_patents_disabled():
    raise HTTPException(status_code=501, detail=_READ_ONLY_DETAIL)


@app.post("/ingest-usaspending")
def ingest_usaspending_disabled():
    raise HTTPException(status_code=501, detail=_READ_ONLY_DETAIL)


@app.post("/delete-ticker")
def delete_ticker_disabled():
    raise HTTPException(status_code=501, detail=_READ_ONLY_DETAIL)


@app.post("/rebuild")
def rebuild_disabled():
    raise HTTPException(status_code=501, detail=_READ_ONLY_DETAIL)


@app.post("/truncate")
def truncate_disabled():
    raise HTTPException(status_code=501, detail=_READ_ONLY_DETAIL)


@app.post("/restore")
def restore_disabled():
    raise HTTPException(status_code=501, detail=_READ_ONLY_DETAIL)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8020")))
