CREATE VECTOR INDEX `fl_chunk_embedding` FOR (n:`Chunk`) ON (n.`embedding`) OPTIONS {indexConfig: {`vector.default_search_expansion_factor`: 3.0,`vector.dimensions`: 1536,`vector.hnsw.ef_construction`: 100,`vector.hnsw.m`: 16,`vector.quantization.type`: 'BINARY',`vector.similarity_function`: 'COSINE'}};
CREATE RANGE INDEX `fl_node_id` FOR (n:`__Node__`) ON (n.`id`);
CREATE RANGE INDEX `fl_tickermeta_ticker` FOR (n:`TickerMeta`) ON (n.`ticker`);
