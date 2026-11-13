"""Verify a Relate store against the read API the UI depends on.

Unlike `test_read_api.py` (which builds a throwaway fixture), this checks the
store the app will actually open — `RELATE_DB_PATH`, default `./data/graph`.
Use it after copying a graph in, to confirm the map, Viewer and KB will work.

    python scripts/verify_store.py
    RELATE_DB_PATH=../private/out/graph python scripts/verify_store.py

Exit code 0 = every check passed.
"""
import os
import sys
import traceback
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "api"))
sys.path.insert(0, str(_ROOT))

from mgapp import storage  # noqa: E402
from llm_app import read_api  # noqa: E402

FAILS: list[str] = []


def check(name: str, fn):
    try:
        value = fn()
        print(f"  ok   {name}")
        return value
    except Exception as e:  # noqa: BLE001
        FAILS.append(f"{name}: {type(e).__name__}: {e}")
        print(f"  FAIL {name}: {type(e).__name__}: {e}")
        return None


def main() -> int:
    path = storage.store_path()
    print(f"store: {path}")
    if not Path(path).exists():
        print("  FAIL store path does not exist")
        return 1

    stats = check("storage.ping", storage.ping)
    if not stats:
        print("  FAIL store is not readable")
        return 1

    s = check("storage.stats", storage.stats)
    if s:
        print(f"       nodes={s['nodes']} chunks={s['chunks']} edges={s['edges']}")
        if s["nodes"] == 0:
            FAILS.append("store has no entity nodes")

    tickers = check("get_ticker_meta_list", read_api.get_ticker_meta_list)
    if tickers is not None:
        print(f"       {len(tickers)} ticker(s): "
              + ", ".join(str(t.get("ticker")) for t in tickers))

    graph = check("get_graph", read_api.get_graph)
    if graph is not None:
        types = sorted({n["type"] for n in graph["nodes"]})
        print(f"       {len(graph['nodes'])} nodes, {len(graph['links'])} links")
        print(f"       types: {', '.join(types)}")
        if not graph["nodes"]:
            FAILS.append("get_graph returned no nodes")
        if not any(n["type"] == "TICKER" for n in graph["nodes"]):
            FAILS.append("no TICKER node on the map")

    if graph and graph["nodes"]:
        sample = next(
            (n for n in graph["nodes"] if n["type"] not in ("TICKER",)), None
        ) or graph["nodes"][0]
        detail = check(f"get_node_detail({sample['id']})",
                       lambda: read_api.get_node_detail(sample["id"]))
        if detail is not None:
            print(f"       chunks={len(detail['chunks'])} "
                  f"neighbors={len(detail['neighbors'])}")

    kb = check("get_kb", read_api.get_kb)
    if kb is not None:
        print(f"       entities={kb['nodes']} chunks={kb['chunks']} "
              f"edges={kb['edges']} filings={len(kb['filings'])} "
              f"size={kb['size_mb']}MB")

    exp = check("export_graph(lean=True)", lambda: read_api.export_graph(lean=True))
    if exp is not None:
        print(f"       {exp['counts']}")

    storage.close()

    print()
    if FAILS:
        print(f"{len(FAILS)} CHECK(S) FAILED")
        for f in FAILS:
            print(f"  - {f}")
        return 1
    print("ALL STORE CHECKS PASSED")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        sys.exit(1)
