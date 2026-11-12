# ══════════════════════════════════════════════════════════════
# call_log.py — in-memory ring buffer of MCP-style graph calls.
#
# Shared by the FastAPI backend (llm_app/main.py) and the MCP server
# (llm_app/mcp_server.py) so the UI's "MCP calls" drawer can show the trail
# of graph operations (cypher / semantic / node lookups) with timing and
# result counts — proof the graph is being driven over MCP, not just rendered.
#
# NOTE: each process has its OWN buffer (they run separately). The UI reads
# the FastAPI process's buffer via GET /mcp-calls; an agent reads the MCP
# server's buffer via the `recent_mcp_calls` tool.
# ══════════════════════════════════════════════════════════════
import threading
import time

_MAX_CALLS = 200


class _CallLog:
    def __init__(self, max_calls: int = _MAX_CALLS):
        self._max = max_calls
        self._calls: list[dict] = []
        self._lock = threading.Lock()

    def log(self, tool: str, detail: str = "", elapsed_ms: float = 0.0,
            count: int = 0, source: str = "", error: str = "") -> None:
        entry = {
            "ts": int(time.time() * 1000),
            "tool": tool,
            "detail": (detail or "")[:160],
            "elapsed_ms": round(elapsed_ms, 1),
            "count": int(count or 0),
            "source": source,
            "error": (error or "")[:160],
        }
        with self._lock:
            self._calls.append(entry)
            if len(self._calls) > self._max:
                self._calls = self._calls[-self._max:]

    def recent(self, limit: int = 100) -> list[dict]:
        with self._lock:
            return list(self._calls[-max(1, min(int(limit or 100), 500)):][::-1])


# module-level singleton — both apps import this
call_log = _CallLog()