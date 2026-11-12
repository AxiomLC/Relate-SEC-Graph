# data/graph — the pre-built graph

This folder holds the Relate **directory store** the app opens at startup
(`RELATE_DB_PATH`, default `./data/graph`).

It is built by the private ingest repo and copied here — the app never writes
to it. A directory store (not a single `.rl` file) is required so the MCP
follower can open it read-only beside the backend.

## If this folder is empty

The app will start but show an empty map. To populate it, run the ingest in the
private repo, then copy the built store here:

```bash
python scripts/export_graph.py --src ./out/graph --dst ../public/data/graph
```

## Layout (created by Relate)

```
data/graph/
├── manifest.json
├── nodes/
├── wal/
└── .cypherlite/          ← schema mirror
```

The `.cypherlite.lock` / `.cypherlite.writer` files are gitignored — they only
exist while a process has the store open.
