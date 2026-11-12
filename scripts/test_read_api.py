"""Exercise the public read path (read_api + storage) on a temp store.

Builds a tiny graph, then calls the vendored read functions. Needs only
relate-db (no fastapi). Run:

    python scripts/test_read_api.py
"""
import os
import sys
import tempfile
import traceback
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "api"))
sys.path.insert(0, str(_ROOT))

_DB = os.path.join(tempfile.mkdtemp(), "graph")
os.environ["RELATE_DB_PATH"] = _DB
os.environ["RELATE_VECTOR_DIM"] = "3"
os.environ["RELATE_READ_ONLY"] = "0"  # writable for the fixture only

from mgapp import storage  # noqa: E402
from llm_app import read_api  # noqa: E402


def build_fixture():
    with storage.session() as s:
        s.run(
            "CREATE (t:TICKER:__Entity__:__Node__ {id: 'ticker:ACME', name: 'ACME Corp', ticker: 'ACME'}), "
            "       (c:CONTRACT:__Entity__:__Node__ {id: 'contract:1', name: 'MSA', ticker: 'ACME', "
            "              source_form: '10-K', exhibit_type: 'EX-10.1'}), "
            "       (ch:Chunk:__Node__ {id: 'chunk:1', text: 'ACME signed an MSA.', ticker: 'ACME', "
            "              chunk_index: 0}), "
            "       (t)-[:HAS_CONTRACT]->(c), "
            "       (ch)-[:MENTIONS]->(c), "
            "       (m:TickerMeta {ticker: 'ACME', company_name: 'ACME Corp', accessions: ['0001'], "
            "              contract_count: 1})"
        )


def main() -> int:
    build_fixture()

    print("=== get_stats ===")
    print(read_api.get_stats())

    print("\n=== get_ticker_meta_list ===")
    print(read_api.get_ticker_meta_list())

    print("\n=== get_graph ===")
    g = read_api.get_graph()
    print("nodes:", [(n["id"], n["type"], n["caption"]) for n in g["nodes"]])
    print("links:", g["links"])
    assert any(n["type"] == "TICKER" for n in g["nodes"]), "no TICKER node on the map"

    print("\n=== get_node_detail ===")
    d = read_api.get_node_detail("contract:1")
    print("summary:", d["summary"], "| chunks:", len(d["chunks"]), "| neighbors:", len(d["neighbors"]))

    print("\n=== export_graph (lean) ===")
    e = read_api.export_graph(lean=True)
    print("counts:", e["counts"])

    print("\n=== get_kb ===")
    kb = read_api.get_kb()
    print("nodes:", kb["nodes"], "chunks:", kb["chunks"], "edges:", kb["edges"],
          "tickers:", len(kb["tickers"]))

    storage.close()
    print("\nALL READ-API CHECKS PASSED")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        sys.exit(1)
