"""Measure what this app actually costs to run: cold start, RAM, disk.

Feeds the comparison numbers in the brief and the video. Everything here is
measured on the machine it runs on — no estimates.

    python scripts/measure_footprint.py

Reports:
  - store size on disk
  - engine cold start (import -> connect -> first query)
  - backend cold start (import app -> first HTTP response)
  - resident memory after serving a graph request
"""
import ctypes
import json
import sys
import threading
import time
import urllib.request
from ctypes import wintypes
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "api"))
sys.path.insert(0, str(_ROOT))


class _PMC(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def rss_mb() -> float | None:
    """Resident set size of this process, in MB. Windows only."""
    try:
        psapi = ctypes.WinDLL("psapi.dll")
        kernel32 = ctypes.WinDLL("kernel32.dll")
        # restype matters: without HANDLE the 64-bit handle is truncated to int
        # and the call fails with an invalid-handle error.
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [
            wintypes.HANDLE, ctypes.POINTER(_PMC), wintypes.DWORD
        ]
        psapi.GetProcessMemoryInfo.restype = wintypes.BOOL

        c = _PMC()
        c.cb = ctypes.sizeof(c)
        ok = psapi.GetProcessMemoryInfo(
            kernel32.GetCurrentProcess(), ctypes.byref(c), c.cb
        )
        return c.WorkingSetSize / 1e6 if ok else None
    except Exception:  # noqa: BLE001 - non-Windows
        return None


def dir_size_mb(path: Path) -> float:
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return total / 1e6


def main() -> int:
    from mgapp import storage

    store = Path(storage.store_path())
    print(f"store: {store}")
    if not store.exists():
        print("FAIL store does not exist")
        return 1

    print(f"  disk: {dir_size_mb(store) * 1000:.0f} KB "
          f"({sum(1 for f in store.rglob('*') if f.is_file())} files)")

    # ── engine cold start: import -> connect -> first query ──
    t0 = time.perf_counter()
    import relate  # noqa: F401  (already imported by storage, timed for honesty)
    conn = relate.connect(str(store), read_only=True)
    row = conn.execute("MATCH (n:__Entity__) RETURN count(n) AS c").fetchone()
    engine_ms = (time.perf_counter() - t0) * 1000
    entities = row["c"] if row else 0
    conn.close()
    print(f"  engine cold start: {engine_ms:.0f} ms  ({entities} entities)")

    # ── backend cold start: import app -> first HTTP response ──
    t0 = time.perf_counter()
    import uvicorn

    from llm_app.main import app

    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=8022, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 30
    while not server.started and time.time() < deadline:
        time.sleep(0.01)
    if not server.started:
        print("FAIL backend did not start")
        return 1

    with urllib.request.urlopen("http://127.0.0.1:8022/health", timeout=30) as r:
        json.loads(r.read().decode())
    backend_ms = (time.perf_counter() - t0) * 1000
    print(f"  backend cold start: {backend_ms:.0f} ms")

    # ── memory after a real graph request ──
    with urllib.request.urlopen("http://127.0.0.1:8022/graph", timeout=60) as r:
        graph = json.loads(r.read().decode())
    mem = rss_mb()
    print(f"  after /graph ({len(graph['nodes'])} nodes): "
          f"{mem:.0f} MB resident" if mem else "  RSS unavailable")

    server.should_exit = True
    thread.join(timeout=10)

    print("\nFor comparison, the same app on Memgraph needs Docker Desktop")
    print("(2-4 GB just to exist) plus a Memgraph container.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
