# ══════════════════════════════════════════════════════════════
# embed.py — query embedding for semantic search.
#
# The graph's chunk embeddings are 1536-dim from OpenAI
# text-embedding-3-small. To search them, the query must be embedded with
# the SAME model, which needs OPENAI_API_KEY. Without a key, semantic
# search is unavailable — the 3D map and Cypher still work.
# ══════════════════════════════════════════════════════════════
import os

_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-small")


def embed_query(text: str) -> list[float]:
    """Embed a query string. Raises RuntimeError if no key is configured."""
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "semantic search needs OPENAI_API_KEY (the graph's vectors are "
            "text-embedding-3-small). The 3D map and Cypher work without it."
        )
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    resp = client.embeddings.create(model=_MODEL, input=text)
    return resp.data[0].embedding
