/**
 * Cloudflare Pages Function for D1 Live Chat
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
  const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 100);
  const sinceId = parseInt(url.searchParams.get('since_id') || '0', 10);

  try {
    let results = [];
    if (sinceId > 0) {
      const query = `
        SELECT id, name, message, created_at
        FROM chat_messages
        WHERE id > ?
        ORDER BY id ASC
        LIMIT ?
      `;
      const res = await env.DB.prepare(query).bind(sinceId, limit).all();
      results = res.results || [];
    } else {
      const query = `
        SELECT id, name, message, created_at
        FROM (
          SELECT id, name, message, created_at
          FROM chat_messages
          ORDER BY id DESC
          LIMIT ?
        )
        ORDER BY id ASC
      `;
      const res = await env.DB.prepare(query).bind(limit).all();
      results = res.results || [];
    }

    return jsonResponse({
      success: true,
      messages: results,
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

  try {
    const body = await request.json().catch(() => ({}));
    let name = String(body.name || '익명').trim().slice(0, 12);
    if (!name) name = '익명';

    let message = String(body.message || '').trim().slice(0, 200);
    if (!message) {
      return jsonResponse({ success: false, error: 'Message cannot be empty.' }, 400);
    }

    const insertRes = await env.DB.prepare(`
      INSERT INTO chat_messages (name, message)
      VALUES (?, ?)
    `).bind(name, message).run();

    const insertId = insertRes?.meta?.last_row_id;

    const createdMsg = {
      id: insertId,
      name,
      message,
      created_at: new Date().toISOString(),
    };

    return jsonResponse({
      success: true,
      message: createdMsg,
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}
