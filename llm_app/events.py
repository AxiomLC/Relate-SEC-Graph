# ══════════════════════════════════════════════════════════════
# events.py — a tiny in-memory event log for the UI's event drawer.
#
# The private app has a richer event log tied to ingest jobs. The public
# app is read-only, so this is a minimal ring buffer: the read endpoints
# emit one line per query, and GET /events returns them.
# ══════════════════════════════════════════════════════════════
import threading
import time

_MAX_EVENTS = 300


class _EventLog:
    def __init__(self, max_events: int = _MAX_EVENTS):
        self._max = max_events
        self._events: list[dict] = []
        self._lock = threading.Lock()

    def emit(self, level: str, message: str, leg: str = "", **extra) -> None:
        entry = {
            "ts": int(time.time() * 1000),
            "level": level,
            "message": message,
            "leg": leg,
            **extra,
        }
        with self._lock:
            self._events.append(entry)
            if len(self._events) > self._max:
                self._events = self._events[-self._max:]

    def list_events(self, limit: int = 200) -> list[dict]:
        with self._lock:
            return list(self._events[-max(1, min(int(limit or 200), 500)):][::-1])


eventlog = _EventLog()
