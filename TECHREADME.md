# TECHREADME — Frontal Lobe on Relate

Technical detail for the embedded build. For the business framing, see `README.md`.

**What this is:** the same Frontal Lobe app that runs on Neo4j AuraDB and on Memgraph,
with the database layer swapped for [Relate](https://relatedb.ai) — an embedded graph
database that runs *inside* the Python process.

---

## What runs where

There is **no database server**. That is the whole point.

| Process | Port | What it is |
|---|---|---|
| `llm_app.main` | 8020 | FastAPI backend. Opens `data/graph/` in-process. |
| `ui/` (Vite) | 5188 | React 3D map. Talks to the backend over HTTP. |
| *(optional)* `relate serve --mcp` | — | stdio sidecar, read-only follower. |

Nothing listens on 7687. There is no Docker container, no connection string, no login.

## Architecture

```
┌──────────────────────────────────────────────┐
│  llm_app/main.py :8020      ← read-only      │
│  └─ llm_app/read_api.py     (vendored reads) │
│     └─ api/mgapp/storage.py (thread-safe)    │
│        └─ relate-db (in-process library)     │
│           └─ data/graph/  ← directory store  │
└─────────────┬────────────────────────────────┘
              │ HTTP
┌─────────────┴────────────────────────────────┐
│  ui/ (Vite) :5188                            │
└──────────────────────────────────────────────┘
```

`read_api.py` is the read half of the mature app's `app/graph.py`, vendored so this repo
never imports `app.*`. The private ingest repo reuses the mature app instead.

## Resource footprint

Measured on the 16 GB dev laptop, 2026-11-13, against the committed demo store
(84 entities, 20 chunks, 118 edges). Re-run with `scripts/measure_footprint.py`.

| | Measured | Notes |
|---|---|---|
| **Store on disk** | **311 KB** (9 files) | 16 KB without vectors; 20 chunk embeddings add ~295 KB |
| **Engine cold start** | **15–17 ms** | import → connect → first query, warm disk cache |
| | ~145 ms | first run on a cold cache |
| **Backend cold start** | **1.2–2.3 s** | dominated by importing FastAPI/pydantic, *not* the database |
| **Backend RSS** | **60 MB** | after serving `/graph` |
| **UI dev server** | 181 MB on disk | `node_modules`; Vite itself is a Node process |
| **UI production build** | ~2.5 MB | static files, no server needed |

Three things worth saying out loud:

1. **The database is not the cost.** Opening the store and running a query is ~15 ms. The
   1.2 s backend start is Python importing a web framework. If you time "graph ready" in
   the demo, time the store open — that's the honest number for the database.
2. **The whole graph lives in RAM** by design (Relate's model). At this size that's
   negligible; the ceiling is real but far above this workload.
3. **The heaviest thing in the stack is the UI dev server**, and it's a build tool, not a
   runtime dependency. The production build is static files.

For contrast: the Memgraph build needs Docker Desktop (2–4 GB just to exist) plus a
Memgraph container, before the app starts.

### The `relate` CLI

A separate Rust binary (installed by `install.sh`, not by pip). Needed only for the MCP
and agent-guardrail demos — the app does not use it.

| | Value |
|---|---|
| Disk | **34.9 MB** (`relate-windows-amd64.exe`, v1.0.1) |
| Installs to | `~/.local/bin/relate.exe` — user-scoped, no admin |
| Background process | None. No service, no daemon, no registry entry |
| JVM | Not needed for the native `.exe` |
| RAM | **Unmeasured** — estimate tens of MB (binary + graph in RAM) |

For scale, the Python engine (`relate-db`) is a 9.9 MB wheel; the CLI is ~3.5× that
because it bundles the whole engine as a standalone binary.

**PATH caveat:** `install.sh` targets `$HOME/.local/bin`, which is not on the default
Windows PATH. Either call it by full path or add that folder to PATH (user-level).

Uninstall is deleting one file.

## Relate constraints that shaped the code

Both were found in Phase 0 and are load-bearing — don't "simplify" them away.

**1. Connections are thread-affine** (DB-API `threadsafety = 1`). FastAPI runs sync
endpoints in a threadpool, so a single global connection raises under load.
`api/mgapp/storage.py` funnels every query through one dedicated worker thread that owns
the connection (`_Executor`).

**2. A `.rl` file cannot be read beside its writer.** A **directory** store can. That's why
the graph ships as `data/graph/` and not `data/graph.rl` — it lets the MCP follower read
the store while the backend holds it.

**3. `datetime()` returns a `Temporal` object**, not a Python datetime. It has no
`isoformat()`, and FastAPI can't encode it. `main.py` registers `Temporal`/`Duration`
encoders; without them `/tickers`, `/kb` and `/export` return 500.

## Endpoints

| Endpoint | Notes |
|---|---|
| `GET /health` | liveness + a real Cypher round-trip |
| `GET /stats` | entity / chunk / edge counts |
| `GET /config` | tuning knobs the UI displays |
| `GET /kb` | KB dashboard: counts, per-ticker specs, filings |
| `GET /graph` | 3D map payload `{nodes, links}` |
| `GET /node/{id}` | Viewer payload: summary + source chunks + neighbors |
| `GET /tickers` | per-ticker ingest records |
| `GET /export` | graph snapshot JSON (`?lean=true` strips vectors) |
| `POST /cypher` | read-only Cypher (write clauses blocked by regex) |
| `POST /semantic` | vector search (needs `OPENAI_API_KEY`) |
| `GET /events`, `GET /mcp-calls` | telemetry drawers |
| `GET /jobs` | always `[]` — no job queue in this build |
| `POST /ingest`, `/ingest-patents`, `/ingest-usaspending`, `/delete-ticker`, `/rebuild`, `/truncate`, `/restore` | **501** — read-only build |

## Hybrid query (pillar 2)

One statement does three things: rank chunks by embedding similarity, rank them by
BM25 keywords, fuse the two lists by reciprocal rank, then walk from each surviving
chunk to the entities it mentions.

```cypher
CALL () {
  MATCH (c:Chunk)
  SEARCH c IN (VECTOR INDEX fl_chunk_embedding FOR $vec LIMIT $k) SCORE AS score
  WITH c ORDER BY score DESC, c.id
  WITH collect(c) AS cs
  UNWIND range(0, size(cs) - 1) AS i
  RETURN cs[i] AS c, 'vector' AS list, i + 1 AS rank
  UNION ALL
  MATCH (c:Chunk)
  SEARCH c IN (FULLTEXT INDEX fl_chunk_text FOR $q LIMIT $k) SCORE AS score
  WITH c ORDER BY score DESC, c.id
  WITH collect(c) AS cs
  UNWIND range(0, size(cs) - 1) AS i
  RETURN cs[i] AS c, 'fulltext' AS list, i + 1 AS rank
}
WITH c, sum(1.0 / (60 + rank)) AS rrf,
     min(CASE list WHEN 'vector' THEN rank END) AS vector_rank,
     min(CASE list WHEN 'fulltext' THEN rank END) AS fulltext_rank
ORDER BY rrf DESC, c.id LIMIT $k
MATCH (c)-[:MENTIONS]->(e:__Entity__)
RETURN c.id AS chunk, round(rrf, 4) AS rrf, vector_rank, fulltext_rank,
       e.name AS entity, e.ticker AS ticker
ORDER BY rrf DESC, chunk
```

Measured on the demo store: **4 ms**, 8 rows. `scripts/hybrid_demo.py` runs it and
prints the two single-leg searches first, so you can see what the fusion combines.

Two indexes must exist: `fl_chunk_embedding` (vector) and `fl_chunk_text` (full-text).
Both are created by `storage.bootstrap()` and by the demo generator.

## Ports & CORS

| Service | Port |
|---|---|
| Backend | 8020 |
| UI | 5188 |

Defaults are baked in: `ui/src/lib/api.js` falls back to `http://localhost:8020`, and the
backend allows `*` when `CORS_ORIGINS` is unset. To pin them, copy `.env.example` to
`.env` and set `PORT` and `CORS_ORIGINS`. Both are read at process start — restart after
editing.

## Scripts

| Script | What it does |
|---|---|
| `scripts/verify_store.py` | check a store against every read function the UI uses |
| `scripts/smoke_http.py` | boot the backend in-process, hit every endpoint |
| `scripts/measure_footprint.py` | cold start, RSS, disk — the numbers above |
| `scripts/hybrid_demo.py` | vector + full-text + traversal in one statement (needs a key) |
| `scripts/test_read_api.py` | build a throwaway fixture, test the read functions |

All four exit non-zero on failure. None of them need a running server.

## Run

```powershell
# both processes, two windows
start.bat

# or separately
.venv\Scripts\python.exe -m llm_app.main
cd ui && npm run dev
```

## What's not here

- **The ingest pipeline.** Proprietary; lives in the private repo. This repo ships a
  pre-built store.
- **The `relate` CLI.** Separate binary. Needed only for the MCP and agent-guardrail
  demos, not for the app.
