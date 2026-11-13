"""Pillar 2 proof: one Cypher statement doing traversal + vector + full-text.

Runs three things against the shipped store, in order:

  1. vector-only search   (SEARCH over the chunk embedding index)
  2. full-text-only search (SEARCH over the chunk text index, BM25)
  3. the hybrid statement  (both, fused by reciprocal rank, then a graph hop
                            from each chunk to the entities it mentions)

Step 3 is the pillar: one statement, three capabilities. The two single-leg
searches are printed first so you can see what the fusion is combining.

    python scripts/hybrid_demo.py
    python scripts/hybrid_demo.py "exclusivity commitment quantum capacity"

Needs OPENAI_API_KEY (the query has to be embedded with the same model as the
chunks). The map and plain Cypher do not.
"""
import sys
import time
from pathlib import Path

# Windows consoles default to cp1252 and mangle the em dashes in entity names.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001 - older interpreters
    pass

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "api"))
sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(_ROOT / ".env", override=True)

from mgapp import storage  # noqa: E402
from llm_app.embed import embed_query  # noqa: E402

VECTOR_ONLY = """
MATCH (c:Chunk)
SEARCH c IN (VECTOR INDEX fl_chunk_embedding FOR $vec LIMIT $k) SCORE AS score
RETURN c.id AS chunk, round(score, 4) AS score
ORDER BY score DESC, chunk
"""

FULLTEXT_ONLY = """
MATCH (c:Chunk)
SEARCH c IN (FULLTEXT INDEX fl_chunk_text FOR $q LIMIT $k) SCORE AS score
RETURN c.id AS chunk, round(score, 4) AS score
ORDER BY score DESC, chunk
"""

# The pillar statement. Two ranked lists in one subquery, fused by
# 1/(60+rank), then a traversal from each surviving chunk to the entities
# it mentions. Verified syntax: relatedb.ai/docs/guides/cypher/
# full-text-and-hybrid-search (relate 1.0.1).
HYBRID = """
CALL () {
  MATCH (c:Chunk)
  SEARCH c IN (VECTOR INDEX fl_chunk_embedding FOR $vec LIMIT $k) SCORE AS score
  WITH c ORDER BY score DESC, c.id
  WITH collect(c) AS cs
  UNWIND range(0, size(cs) - 1) AS i
  RETURN cs[i] AS c, 'vector' AS list, i + 1 AS rank
  UNION ALL
  MATCH (c:Chunk)
  SEARCH c IN (FULLTEXT INDEX fl_chunk_text FOR $q LIMIT $k) SCORE AS score
  WITH c ORDER BY score DESC, c.id
  WITH collect(c) AS cs
  UNWIND range(0, size(cs) - 1) AS i
  RETURN cs[i] AS c, 'fulltext' AS list, i + 1 AS rank
}
WITH c, sum(1.0 / (60 + rank)) AS rrf,
     min(CASE list WHEN 'vector' THEN rank END) AS vector_rank,
     min(CASE list WHEN 'fulltext' THEN rank END) AS fulltext_rank
ORDER BY rrf DESC, c.id LIMIT $k
MATCH (c)-[:MENTIONS]->(e:__Entity__)
RETURN c.id AS chunk, round(rrf, 4) AS rrf, vector_rank, fulltext_rank,
       e.name AS entity, e.ticker AS ticker
ORDER BY rrf DESC, chunk
"""


def _clip(text: str, n: int = 78) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1] + "..."


def main() -> int:
    query = " ".join(sys.argv[1:]) or "exclusivity commitment quantum capacity"
    k = 8

    print(f'query: "{query}"')
    t0 = time.perf_counter()
    vec = embed_query(query)
    print(f"embedded in {(time.perf_counter() - t0) * 1000:.0f} ms "
          f"({len(vec)} dims)\n")

    with storage.session(access="read") as s:
        print("=== 1. vector only ===")
        for r in s.run(VECTOR_ONLY, vec=vec, k=k):
            print(f"  {r['chunk']:<16} {r['score']}")

        print("\n=== 2. full-text only (BM25) ===")
        for r in s.run(FULLTEXT_ONLY, q=query, k=k):
            print(f"  {r['chunk']:<16} {r['score']}")

        print("\n=== 3. hybrid: vector + full-text + traversal, one statement ===")
        t0 = time.perf_counter()
        rows = list(s.run(HYBRID, vec=vec, q=query, k=k))
        elapsed = (time.perf_counter() - t0) * 1000

        if not rows:
            print("  (no rows)")
        else:
            print(f"  {'chunk':<16} {'rrf':>7} {'vec':>4} {'ft':>4}  entity")
            for r in rows:
                vr = r["vector_rank"] if r["vector_rank"] is not None else "-"
                fr = r["fulltext_rank"] if r["fulltext_rank"] is not None else "-"
                print(f"  {r['chunk']:<16} {r['rrf']:>7} {str(vr):>4} {str(fr):>4}  "
                      f"{r['entity']} ({r['ticker']})")

        print(f"\n  one statement, {elapsed:.0f} ms, {len(rows)} rows")

        print("\n=== source text behind the top fused chunk ===")
        if rows:
            top = rows[0]["chunk"]
            row = s.run(
                "MATCH (c:Chunk {id: $id}) RETURN c.text AS text, "
                "c.section_title AS section", id=top,
            ).single()
            if row:
                print(f"  {top} [{row['section']}]")
                print(f"  {_clip(row['text'], 300)}")

    storage.close()
    print("\nHYBRID OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
