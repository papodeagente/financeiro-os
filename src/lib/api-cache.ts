import pool, { initDB } from './db';

export async function getCached(key: string): Promise<unknown | null> {
  await initDB();
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT data, calls_saved FROM api_cache WHERE key = $1 AND expires_at > NOW()`,
    [key]
  );
  if (rows.length === 0) return null;
  // Increment calls_saved
  await pool.query(`UPDATE api_cache SET calls_saved = calls_saved + 1 WHERE key = $1`, [key]);
  return rows[0].data;
}

export async function setCache(key: string, data: unknown, source: string, ttlSeconds: number) {
  await initDB();
  if (!pool) return;
  await pool.query(
    `INSERT INTO api_cache (key, source, data, calls_saved, created_at, expires_at)
     VALUES ($1, $2, $3, 0, NOW(), NOW() + INTERVAL '1 second' * $4)
     ON CONFLICT (key) DO UPDATE SET data = $3, source = $2, calls_saved = 0, created_at = NOW(), expires_at = NOW() + INTERVAL '1 second' * $4`,
    [key, source, JSON.stringify(data), ttlSeconds]
  );
}

export async function getCacheStats() {
  await initDB();
  if (!pool) return { total_entries: 0, total_calls_saved: 0, by_source: [] };
  const { rows } = await pool.query(
    `SELECT source, COUNT(*)::int as entries, COALESCE(SUM(calls_saved), 0)::int as calls_saved
     FROM api_cache GROUP BY source`
  );
  const total_entries = rows.reduce((s, r) => s + r.entries, 0);
  const total_calls_saved = rows.reduce((s, r) => s + r.calls_saved, 0);
  return { total_entries, total_calls_saved, by_source: rows };
}

export async function clearExpiredCache() {
  await initDB();
  if (!pool) return;
  await pool.query(`DELETE FROM api_cache WHERE expires_at < NOW()`);
}
