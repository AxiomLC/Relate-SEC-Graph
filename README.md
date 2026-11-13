# Frontal Lobe — a knowledge graph you can query in plain language

**Reads real SEC contracts, USPTO patents, and federal awards, turns them into a graph,
and lets you explore it in 3D or ask it questions.** Runs on [Relate](https://relatedb.ai),
an embedded graph database — no server, no Docker, no connection string.

> **Status:** the app and the read path are complete. The graph is pre-built and shipped
> in `data/graph/`. The ingest pipeline is not in this repo — see
> [What's not here yet](#whats-not-here-yet).

---

## The problem

If you want to understand a company, the paperwork is where the truth is — but it's
scattered across three different government systems, in three different formats, and none
of them talk to each other.

- **SEC EDGAR** holds the contracts. Who they signed with, for how much, under what terms.
- **USPTO** holds the patents. What they actually own, and who invented it.
- **USASpending** holds the federal awards. Who the government pays, and for what.

Answering one real question — *"who does this company depend on, and what do they own?"* —
means opening dozens of filings and cross-referencing them by hand.

This app does that once, stores the result as a graph, and lets you ask.

## What you get

- **A 3D map** of companies, contracts, patents, inventors, technologies, and awards.
- **Semantic search** — type a question, get the nodes that answer it.
- **Cypher** — write a graph query and see the results land on the map.
- **Every fact links back to its source text.** No unsourced claims.

## Quickstart

Requires **Python 3.11+** and **Node 18+**. No database server, no Docker.

```powershell
# 1. Python deps (a venv keeps it clean)
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

# 2. Run the backend — it opens data/graph/ and listens on :8020
.venv\Scripts\python.exe -m llm_app.main

# 3. In a second terminal, run the UI
cd ui
npm install
npm run dev
```

Open the UI at **http://localhost:5188**.

The graph lives at `data/graph/` — a Relate **directory store**, committed to this repo.
Point `RELATE_DB_PATH` somewhere else to open a different one.

The 3D map and Cypher work with **no API keys**. Semantic search needs `OPENAI_API_KEY`,
because the graph's vectors are `text-embedding-3-small` and the query has to be embedded
with the same model.

### Check it before you trust it

```powershell
# read path against the shipped store (no server needed)
.venv\Scripts\python.exe scripts\verify_store.py

# boot the backend in-process and exercise every endpoint the UI calls
.venv\Scripts\python.exe scripts\smoke_http.py
```

Both exit non-zero on failure. `scripts/test_read_api.py` builds a throwaway fixture
instead, if you want to test the read functions without a store.

### No graph yet?

`data/graph/` ships with a demo graph of five hard-tech companies. If it's ever empty,
`data/README.md` explains how to rebuild or replace it.

## What's in the graph

The committed graph covers a handful of mid-tier hard-tech companies — quantum, photonics,
and future-materials firms.

| Node | What it represents |
|---|---|
| `TICKER` | A public company |
| `SUBSIDIARY` | A company it owns |
| `CONTRACT` | A material contract filed with the SEC |
| `DEAL_EVENT` | An announced deal with no contract filed |
| `CONTRACT_TERM` | A specific obligation inside a contract |
| `PATENT` | A patent it owns |
| `INVENTOR` | A person named on a patent |
| `TECHNOLOGY` | A technology area |
| `FEDERAL_AWARD` | A federal contract or grant |
| `PRODUCT` | What an award or contract was for |
| `Chunk` | The source text behind every fact (hidden from the map) |

Edges connect them: `HAS_CONTRACT`, `HAS_TERM`, `SUBSIDIARY_OF`, `HAS_PATENT`,
`INVENTED_BY`, `LEVERAGES_TECH`, `HAS_AWARD`, `AWARDED_BY`, `HAS_PRODUCT`, `COVERS`,
`BUYS`, and `MENTIONS` (chunk → entity).

## Built on Relate

Relate is an embedded graph database. It runs **inside** the app instead of beside it —
closer to SQLite than to a database server. This app leans on four things it does:

| | What it means here |
|---|---|
| **Embedded** | The graph is one folder. No Docker, no ports, no connection string. |
| **One statement, three searches** | A single Cypher statement can mix graph traversal, vector similarity, and full-text search. |
| **MCP built in** | `relate serve --mcp` exposes the graph to any agent. |
| **Agent guardrails** | Row caps with truncation markers, and typed errors that say whether a retry helps. |

Two Relate behaviours shaped the code, and both are worth knowing if you extend it:

- **Connections are thread-affine.** FastAPI runs sync endpoints in a threadpool, so
  `api/mgapp/storage.py` funnels every query through one dedicated worker thread that owns
  the connection. A single global connection would raise under load.
- **A `.rl` file can't be read beside its writer.** A **directory** store can, which is why
  the graph ships as `data/graph/` and not `data/graph.rl` — it lets the MCP server read
  the store while the backend holds it.

## What's not here yet

**The ingest pipeline is not in this repo.** It's proprietary — the parsing rules, the
extraction prompts, and the quality checks that make the graph trustworthy took real work
to get right.

This repo ships a **pre-built graph** so you can run the demo end to end without it.

Because the store is read-only here, the write endpoints (`/ingest`, `/rebuild`,
`/truncate`, `/restore`, `/delete-ticker`) answer with **HTTP 501** and a message saying so,
rather than pretending to work. `/jobs` returns an empty list.

If you want to talk about how the pipeline works, I'm happy to walk through the design.

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

Optional sidecar (read-only follower):
  relate serve --mcp stdio --database ./data/graph --read-only=live
```

No Docker. No database server. One folder.

## License

AGPL-3.0. See `LICENSE`.

## Links

- [Relate docs](https://relatedb.ai/docs/llms.txt)
- [Relate on GitHub](https://github.com/relatedb/relate)
- [Relate hackathon](https://neo4j.com/blog/graph-database/announcing-the-relate-by-neo4j-hackathon-2026-build-ai-agents-on-an-embedded-graph-database/)
