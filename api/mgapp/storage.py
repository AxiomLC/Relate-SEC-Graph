# ══════════════════════════════════════════════════════════════
# storage.py — Frontal Lobe → Relate data layer (READ-ONLY)
#
# The public app ships a pre-built graph and never writes. This is the
# read half of the private repo's storage.py: same thread-safe executor
# and session() adapter, but no write functions and a read-only default.
#
# Two constraints shape this file (see the private repo / buildREADME):
#   1. Connections are THREAD-AFFINE (DB-API threadsafety = 1). FastAPI
#      runs sync endpoints in a threadpool, so every query is marshalled
#      onto ONE dedicated worker thread that owns the connection.
#   2. A `.rl` file cannot be read beside its writer; a DIRECTORY store
#      can. We ship a directory store (data/graph).
# ══════════════════════════════════════════════════════════════
import os
import queue
import threading
from contextlib import contextmanager
from typing import Any

import relate

DEFAULT_DB_PATH = "./data/graph"


def store_path() -> str:
    return os.getenv("RELATE_DB_PATH", DEFAULT_DB_PATH)


def _read_only() -> bool:
    # Public is read-only unless explicitly overridden.
    return os.getenv("RELATE_READ_ONLY", "1").strip().lower() in ("1", "true", "yes")


VECTOR_INDEX_NAME = os.getenv("RELATE_VECTOR_INDEX", "fl_chunk_embedding")
VECTOR_INDEX_DIM = int(os.getenv("RELATE_VECTOR_DIM", "1536"))  # text-embedding-3-small

BASE_NODE = "__Node__"
BASE_ENTITY = "__Entity__"


# ══════════════════════════════════════════════════════════════
# Thread-safe executor — the ONE thread that owns the connection.
# ══════════════════════════════════════════════════════════════
class _Executor:
    def __init__(self) -> None:
        self._q: "queue.Queue" = queue.Queue()
        self._conn: Any = None
        self._ready = threading.Event()
        self._open_error: BaseException | None = None
        self._thread = threading.Thread(target=self._run, name="relate-db", daemon=True)
        self._thread.start()
        self._ready.wait()
        if self._open_error is not None:
            raise self._open_error

    def _run(self) -> None:
        try:
            self._conn = relate.connect(store_path(), read_only=_read_only())
        except BaseException as e:  # noqa: BLE001
            self._open_error = e
            self._ready.set()
            return
        self._ready.set()
        while True:
            item = self._q.get()
            if item is None:
                break
            fn, box, done = item
            try:
                box["result"] = fn(self._conn)
            except BaseException as e:  # noqa: BLE001
                box["error"] = e
            finally:
                done.set()
        try:
            self._conn.close()
        except Exception:  # noqa: BLE001
            pass

    def call(self, fn):
        box: dict = {}
        done = threading.Event()
        self._q.put((fn, box, done))
        done.wait()
        if "error" in box:
            raise box["error"]
        return box["result"]

    def close(self) -> None:
        self._q.put(None)


_exec: _Executor | None = None
_exec_lock = threading.Lock()


def _get_exec() -> _Executor:
    global _exec
    if _exec is None:
        with _exec_lock:
            if _exec is None:
                _exec = _Executor()
    return _exec


def close() -> None:
    global _exec
    with _exec_lock:
        if _exec is not None:
            _exec.close()
            _exec = None


# ══════════════════════════════════════════════════════════════
# session() — the Memgraph-shaped adapter over the executor
# ══════════════════════════════════════════════════════════════
class _Result:
    def __init__(self, cursor) -> None:
        self._cursor = cursor

    def single(self):
        return self._cursor.fetchone()

    def fetchone(self):
        return self._cursor.fetchone()

    def fetchall(self):
        return self._cursor.fetchall()

    def data(self):
        return self._cursor.fetchall()

    def __iter__(self):
        return iter(self._cursor)

    @property
    def stats(self) -> dict:
        return self._cursor.stats


class _Session:
    def __init__(self, access: str = "read") -> None:
        self._access = access

    def run(self, stmt: str, **params) -> _Result:
        ex = _get_exec()
        cursor = ex.call(lambda conn: conn.execute(stmt, params or None))
        return _Result(cursor)

    def __enter__(self) -> "_Session":
        return self

    def __exit__(self, *exc) -> bool:
        return False


@contextmanager
def session(access: str = "read"):
    yield _Session(access)


# ── health ──
def ping() -> bool:
    try:
        with session() as s:
            s.run("RETURN 1 AS ok").single()
        return True
    except Exception:  # noqa: BLE001
        return False


# ── vector search (the semantic-search leg) ──
def vector_search(query_vec: list[float], top_k: int = 20) -> list[dict]:
    """Cosine nearest-neighbor over the Chunk embedding index via Relate's
    SEARCH clause. Returns [{node_id, score}] sorted by score DESC."""
    with session(access="read") as s:
        recs = list(s.run(
            "MATCH (c:Chunk) "
            f"SEARCH c IN (VECTOR INDEX {VECTOR_INDEX_NAME} FOR $vec LIMIT $k) "
            "SCORE AS score "
            "RETURN c.id AS id, score ORDER BY score DESC",
            vec=list(query_vec), k=top_k,
        ))
    return [{"node_id": r["id"], "score": float(r["score"])} for r in recs]


# ── read helpers ──
def stats() -> dict:
    with session() as s:
        nodes = s.run("MATCH (n:__Entity__) RETURN count(n) AS c").single()["c"]
        chunks = s.run("MATCH (n:Chunk) RETURN count(n) AS c").single()["c"]
        edges = s.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
    return {"nodes": int(nodes), "chunks": int(chunks), "edges": int(edges)}


def all_nodes(limit: int = 500) -> list[dict]:
    with session(access="read") as s:
        return [dict(r["n"]) for r in s.run(
            "MATCH (n) RETURN n LIMIT $limit", limit=limit)]
