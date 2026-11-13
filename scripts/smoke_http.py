"""Boot the backend in-process and exercise every endpoint the UI calls.

No external server, no curl, no ports left open: uvicorn runs in a thread,
the checks run against it, then it shuts down.

    python scripts/smoke_http.py
    python scripts/smoke_http.py --port 8021

Exit code 0 = every endpoint answered as expected.
"""
import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "api"))
sys.path.insert(0, str(_ROOT))

import uvicorn  # noqa: E402

from llm_app.main import app  # noqa: E402

FAILS: list[str] = []


def _get(base: str, path: str):
    with urllib.request.urlopen(f"{base}{path}", timeout=30) as r:
        return r.status, json.loads(r.read().decode())


def _post(base: str, path: str, payload: dict):
    req = urllib.request.Request(
        f"{base}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def check(label: str, fn, expect=(200,)):
    try:
        status, body = fn()
    except Exception as e:  # noqa: BLE001
        FAILS.append(f"{label}: {type(e).__name__}: {e}")
        print(f"  FAIL {label}: {type(e).__name__}: {e}")
        return None
    if status not in expect:
        FAILS.append(f"{label}: HTTP {status} {str(body)[:160]}")
        print(f"  FAIL {label}: HTTP {status} {str(body)[:160]}")
        return None
    print(f"  ok   {label}  (HTTP {status})")
    return body


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8021)
    args = ap.parse_args()
    base = f"http://127.0.0.1:{args.port}"

    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=args.port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.time() + 30
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    if not server.started:
        print("FAIL server did not start")
        return 1

    try:
        health = check("GET /health", lambda: _get(base, "/health"))
        if health and not health.get("db"):
            FAILS.append("/health reports db=false")

        stats = check("GET /stats", lambda: _get(base, "/stats"))
        if stats:
            print(f"       {stats}")

        check("GET /config", lambda: _get(base, "/config"))
        check("GET /tickers", lambda: _get(base, "/tickers"))

        kb = check("GET /kb", lambda: _get(base, "/kb"))
        if kb:
            print(f"       entities={kb['nodes']} chunks={kb['chunks']} "
                  f"edges={kb['edges']} tickers={len(kb['tickers'])}")

        graph = check("GET /graph", lambda: _get(base, "/graph"))
        if graph:
            print(f"       {len(graph['nodes'])} nodes, {len(graph['links'])} links")
            if not graph["nodes"]:
                FAILS.append("/graph returned no nodes")

        if graph and graph["nodes"]:
            nid = graph["nodes"][0]["id"]
            check(f"GET /node/{nid}",
                  lambda: _get(base, f"/node/{urllib.parse.quote(nid)}"))

        check("GET /export?lean=true", lambda: _get(base, "/export?lean=true"))
        check("GET /events", lambda: _get(base, "/events"))
        check("GET /mcp-calls", lambda: _get(base, "/mcp-calls"))

        cy = check("POST /cypher", lambda: _post(base, "/cypher", {
            "query": "MATCH (n:TICKER) RETURN n.name AS name, n.ticker AS ticker",
            "types": [], "hidden_bands": [], "limit": 50,
        }))
        if cy:
            print(f"       {cy['meta']['count']} row(s)")

        # write clauses must be refused by the read-only guard
        check("POST /cypher (write blocked)",
              lambda: _post(base, "/cypher", {"query": "CREATE (n:X) RETURN n"}),
              expect=(400,))

        # semantic search needs OPENAI_API_KEY; without one it must fail cleanly
        sem = check("POST /semantic", lambda: _post(base, "/semantic", {
            "text": "quantum error correction", "limit": 5,
        }), expect=(200, 503))
        if sem is not None:
            print(f"       meta={sem.get('meta')}")

        # read-only stubs: the UI's write panels must get a clear answer
        check("POST /ingest (read-only stub)",
              lambda: _post(base, "/ingest", {"tickers": ["IONQ"]}),
              expect=(501,))
        check("GET /jobs (read-only stub)", lambda: _get(base, "/jobs"))
    finally:
        server.should_exit = True
        thread.join(timeout=10)

    print()
    if FAILS:
        print(f"{len(FAILS)} CHECK(S) FAILED")
        for f in FAILS:
            print(f"  - {f}")
        return 1
    print("ALL HTTP CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
