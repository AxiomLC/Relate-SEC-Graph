# Frontal Lobe — a knowledge graph you can query in plain language

**Reads real SEC contracts, USPTO patents, and federal awards, turns them into a graph,
and lets you explore it in 3D or ask it questions.** Runs on [Relate](https://relatedb.ai),
an embedded graph database — no server, no Docker, no connection string.

> **Status:** in progress. The graph and the read path are the current focus. See
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
- **An MCP server** — any agent that speaks Model Context Protocol can drive it.
- **Every fact links back to its source text.** No unsourced claims.

## Quickstart

```powershell
# 1. Install Relate
curl.exe -sSfL https://relatedb.ai/install.sh | bash
relate --version

# 2. Python deps
python -m pip install -r requirements.txt

# 3. Run the backend (it opens data/graph.rl)
python -m llm_app.main

# 4. In a second terminal, run the UI
cd ui
npm install
npm run dev
```

Open the UI at **http://localhost:5188**.

The graph is already built and committed at `data/graph.rl`. You don't need any API keys
to explore it.

## What's in the graph

The committed graph covers a handful of mid-tier hard-tech companies — quantum, photonics,
and future-materials firms.

| Node | What it represents |
|---|---|
| `TICKER` | A public company |
| `SUBSIDIARY` | A company it owns |
| `CONTRACT` | A material contract filed with the SEC |
| `DEAL_EVENT` | An announced deal with no contract filed |
| `PATENT` | A patent it owns |
| `INVENTOR` | A person named on a patent |
| `TECHNOLOGY` | A technology area |
| `FEDERAL_AWARD` | A federal contract or grant |
| `PRODUCT` | What an award was for |
| `Chunk` | The source text behind every fact (hidden from the map) |

Edges connect them: `HAS_CONTRACT`, `SUBSIDIARY_OF`, `HAS_PATENT`, `INVENTED_BY`,
`LEVERAGES_TECH`, `HAS_AWARD`, `AWARDED_BY`, and more.

## Built on Relate

Relate is an embedded graph database. It runs **inside** the app instead of beside it —
closer to SQLite than to a database server. This app leans on four things it does:

| | What it means here |
|---|---|
| **Embedded** | The graph is one file. No Docker, no ports, no connection string. |
| **One statement, three searches** | A single Cypher statement can mix graph traversal, vector similarity, and full-text search. |
| **MCP built in** | `relate serve --mcp` exposes the graph to any agent. |
| **Agent guardrails** | Row caps with truncation markers, and typed errors that say whether a retry helps. |

## What's not here yet

**The ingest pipeline is not in this repo.** It's proprietary — the parsing rules, the
extraction prompts, and the quality checks that make the graph trustworthy took real work
to get right.

This repo ships a **pre-built graph** so you can run the demo end to end without it.

If you want to talk about how the pipeline works, I'm happy to walk through the design.

## Architecture

```
┌──────────────────────────────────────────────┐
│  llm_app/main.py :8020        ← only writer  │
│  └─ api/mgapp/storage.py                     │
│     └─ relate-db (in-process library)        │
│        └─ data/graph.rl  ← one file          │
└─────────────┬────────────────────────────────┘
              │ HTTP
┌─────────────┴────────────────────────────────┐
│  ui/ (Vite) :5188                            │
└──────────────────────────────────────────────┘
```

No Docker. No database server. One file.

## License

AGPL-3.0. See `LICENSE`.

## Links

- [Relate docs](https://relatedb.ai/docs/llms.txt)
- [Relate on GitHub](https://github.com/relatedb/relate)
- [Relate hackathon](https://neo4j.com/blog/graph-database/announcing-the-relate-by-neo4j-hackathon-2026-build-ai-agents-on-an-embedded-graph-database/)
