/**
 * Cloudflare Pages Function for D1 Online Ranking
 * Bound to D1 as "DB"
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

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) {
    return jsonResponse({ success: false, error: 'DB binding is missing' }, 500);
  }

  const url = new URL(request.url);
  const rawLimit = parseInt(url.searchParams.get('limit') || '20', 10);
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 20 : rawLimit), 100);
  const DEFAULT_START_DATE = '2026-10-11 14:35:00';
  const showAll = url.searchParams.get('all') === 'true';
  const customSince = url.searchParams.get('since');
  const startDate = customSince || (showAll ? null : (env.RANKING_START_DATE || DEFAULT_START_DATE));

  try {
    let query = `
      SELECT id, name, score, lines, level, created_at
      FROM rankings
    `;
    const params = [];
    if (startDate) {
      query += ` WHERE created_at >= ? `;
      params.push(startDate);
    }
    query += `
      ORDER BY score DESC, lines DESC, id ASC
      LIMIT ?
    `;
    params.push(limit);

    const { results } = await env.DB.prepare(query).bind(...params).all();

    return jsonResponse({
      success: true,
      rankings: results || [],
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) {
    return jsonResponse({ success: false, error: 'DB binding is missing' }, 500);
  }

  const DEFAULT_START_DATE = '2026-10-11 14:35:00';
  const startDate = env.RANKING_START_DATE || DEFAULT_START_DATE;

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

    let rankNumber = 1;
    try {
      let rankQuerySql = `
        SELECT COUNT(*) AS ahead_count
        FROM rankings
        WHERE (score > ? OR (score = ? AND lines > ?))
      `;
      const rankParams = [score, score, lines];
      if (startDate) {
        rankQuerySql += ` AND created_at >= ? `;
        rankParams.push(startDate);
      }
      const rankQuery = await env.DB.prepare(rankQuerySql).bind(...rankParams).first();
      rankNumber = (rankQuery?.ahead_count || 0) + 1;
    } catch (_) {}

    return jsonResponse({
      success: true,
      id: insertId,
      rank: rankNumber,
      entry: { name, score, lines, level },
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}
