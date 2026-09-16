/**
 * Cloudflare Worker for DigitalArts Tetris D1 Online Ranking
 * Database: digitalarts-tetris (D1 binding: DB)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

let tableInitialized = false;
async function ensureTable(db) {
  if (tableInitialized) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS rankings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        score INTEGER NOT NULL,
        lines INTEGER NOT NULL,
        level INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    await db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_rankings_score ON rankings (score DESC, lines DESC)
    `).run();
    tableInitialized = true;
  } catch (err) {
    console.error('Failed to auto-initialize rankings table:', err);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // API Routes
    if (pathname === '/api/ranking' || pathname === '/api/rankings') {
      if (!env.DB) {
        return jsonResponse(
          { success: false, error: 'D1 database binding "DB" is missing in environment.' },
          500
        );
      }

      await ensureTable(env.DB);

      // GET: Retrieve Top Rankings
      if (request.method === 'GET') {
        try {
          const rawLimit = parseInt(searchParams.get('limit') || '10', 10);
          const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 10 : rawLimit), 100);

          const { results } = await env.DB.prepare(`
            SELECT id, name, score, lines, level, created_at
            FROM rankings
            ORDER BY score DESC, lines DESC, id ASC
            LIMIT ?
          `).bind(limit).all();

          return jsonResponse({
            success: true,
            rankings: results || [],
          });
        } catch (err) {
          console.error('GET /api/ranking error:', err);
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }

      // POST: Submit a New Score
      if (request.method === 'POST') {
        try {
          const body = await request.json().catch(() => ({}));
          let name = String(body.name || 'PLAYER').trim().slice(0, 15);
          if (!name) name = 'PLAYER';

          const score = Math.max(0, parseInt(body.score, 10) || 0);
          const lines = Math.max(0, parseInt(body.lines, 10) || 0);
          const level = Math.max(1, parseInt(body.level, 10) || 1);

          if (score === 0) {
            return jsonResponse({ success: false, error: 'Score must be greater than 0' }, 400);
          }

          const insertRes = await env.DB.prepare(`
            INSERT INTO rankings (name, score, lines, level)
            VALUES (?, ?, ?, ?)
          `).bind(name, score, lines, level).run();

          const insertId = insertRes?.meta?.last_row_id;

          // Calculate current rank of this score
          let rankNumber = 1;
          try {
            const rankQuery = await env.DB.prepare(`
              SELECT COUNT(*) AS ahead_count
              FROM rankings
              WHERE score > ? OR (score = ? AND lines > ?)
            `).bind(score, score, lines).first();
            rankNumber = (rankQuery?.ahead_count || 0) + 1;
          } catch (_) {
            /* rank count is non-fatal */
          }

          return jsonResponse({
            success: true,
            id: insertId,
            rank: rankNumber,
            entry: { name, score, lines, level },
          });
        } catch (err) {
          console.error('POST /api/ranking error:', err);
          return jsonResponse({ success: false, error: err.message }, 500);
        }
      }

      return jsonResponse({ success: false, error: 'Method Not Allowed' }, 405);
    }

    // Static Asset fallback if deployed with Assets
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('DigitalArts Tetris API is running.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};
