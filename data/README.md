# data/graph — the pre-built graph

This folder holds the Relate **directory store** the app opens at startup
(`RELATE_DB_PATH`, default `./data/graph`).

It is built by the private ingest repo and copied here — the app never writes to it.
A directory store (not a single `.rl` file) is required so the MCP follower can open it
read-only beside the backend.

## Layout (created by Relate)

```
data/graph/
├── manifest.json
├── nodes/
├── relationships/
├── wal/
└── .cypherlite/          ← schema mirror
```

`.cypherlite.lock` and `.cypherlite.writer` are gitignored — they only exist while a
process has the store open. **Commit everything else.**

## Replacing it with a real ingest

In the private repo, after an ingest writes `out/graph`:

```bash
python scripts/export_graph.py --src ./out/graph --dst ../public/data/graph --force
```

Then commit the result here.

## If this folder is empty

The app still starts, but the map will be empty. Two ways to fill it:

1. **Copy a real store in** (above).
2. **Generate the demo graph** — five hard-tech companies, ~80 entities, ~120 edges,
   matching the schema the read API expects:

   ```bash
   # from the private repo
   python scripts/make_demo_graph.py --force
   ```

   Add `--embed` to also embed the chunk text with OpenAI, which makes semantic search
   work (needs `OPENAI_API_KEY`).

## Verify

```bash
# from the public repo root
python scripts/verify_store.py
```

It checks the store against every read function the UI depends on and exits non-zero on
failure.
