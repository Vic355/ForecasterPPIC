// Cloudflare Worker: serves the static app in ./public and a small AI endpoint for the Asisten.
// /api/ask runs a Workers AI model in this Cloudflare account. On the Workers Free plan the daily
// free allowance simply runs out (requests get an error until the next day); nothing is billed.
// On a Workers Paid plan, usage beyond the free allowance is billed, so keep an eye on it there.
const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const ROLES = ['system', 'user', 'assistant'];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

// /api/produksi: shared storage for the daily production monitoring page (/produksi/).
// Needs a D1 database bound as DB in wrangler.jsonc; without it the page keeps entries in the browser.
// Writes are only accepted from the site itself, and, if the EDIT_KEY variable is set, with that key.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-\d{2}$/;
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS prod_actual (period TEXT NOT NULL, line TEXT NOT NULL, day TEXT NOT NULL, ct REAL NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (period, line, day))'),
    db.prepare('CREATE TABLE IF NOT EXISTS prod_plan (period TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL)'),
  ]);
  schemaReady = true;
}
async function produksi(request, env, url) {
  if (!env.DB) return json({ ok: false, error: 'Database belum disambungkan (binding DB).' }, 503);
  await ensureSchema(env.DB);
  const period = url.searchParams.get('period') || '';
  if (!PERIOD.test(period)) return json({ error: 'Periode tidak valid.' }, 400);
  if (request.method === 'GET') {
    const [a, p] = await env.DB.batch([
      env.DB.prepare('SELECT line, day, ct, updated_at FROM prod_actual WHERE period = ?').bind(period),
      env.DB.prepare('SELECT body, updated_at FROM prod_plan WHERE period = ?').bind(period),
    ]);
    const plan = p.results[0] ? JSON.parse(p.results[0].body) : null;
    return json({ ok: true, period, actual: a.results, plan, planUpdated: p.results[0] ? p.results[0].updated_at : null });
  }
  if (request.method !== 'PUT') return json({ error: 'Metode tidak didukung.' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== url.host) return json({ error: 'Asal permintaan tidak diizinkan.' }, 403);
  if (env.EDIT_KEY && request.headers.get('x-edit-key') !== env.EDIT_KEY) return json({ error: 'Kode edit salah.' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Body bukan JSON.' }, 400); }
  const now = new Date().toISOString();
  if (url.pathname === '/api/produksi/plan') {
    if (!body || !Array.isArray(body.lines) || !body.lines.length) return json({ error: 'Rencana kosong.' }, 400);
    const text = JSON.stringify(body);
    if (text.length > 900000) return json({ error: 'Rencana terlalu besar.' }, 413);
    await env.DB.prepare('INSERT INTO prod_plan (period, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(period) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at').bind(period, text, now).run();
    return json({ ok: true, updated_at: now });
  }
  const cells = (Array.isArray(body && body.cells) ? body.cells : []).slice(0, 5000)
    .filter((c) => c && typeof c.line === 'string' && c.line.length <= 80 && DAY.test(c.day || ''));
  if (!cells.length) return json({ error: 'Tidak ada data.' }, 400);
  const stmts = cells.map((c) => {
    const v = c.ct === null || c.ct === '' || c.ct === undefined ? null : Number(c.ct);
    if (v === null || !isFinite(v)) return env.DB.prepare('DELETE FROM prod_actual WHERE period = ? AND line = ? AND day = ?').bind(period, c.line, c.day);
    return env.DB.prepare('INSERT INTO prod_actual (period, line, day, ct, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(period, line, day) DO UPDATE SET ct = excluded.ct, updated_at = excluded.updated_at').bind(period, c.line, c.day, v, now);
  });
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return json({ ok: true, saved: cells.length, updated_at: now });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/produksi')) return produksi(request, env, url);
    if (url.pathname !== '/api/ask') return env.ASSETS.fetch(request);
    const model = env.AI_MODEL || MODEL;
    if (!env.AI) return json({ ok: false, error: 'Workers AI belum diaktifkan untuk Worker ini.' }, 503);
    if (request.method === 'GET') return json({ ok: true, model });
    if (request.method !== 'POST') return json({ error: 'Metode tidak didukung.' }, 405);
    // only the app itself may call this (blocks other sites from spending the allowance)
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) return json({ error: 'Asal permintaan tidak diizinkan.' }, 403);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Body bukan JSON.' }, 400); }
    const messages = (Array.isArray(body && body.messages) ? body.messages : [])
      .filter((m) => m && ROLES.includes(m.role) && typeof m.content === 'string')
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 12000) }));
    if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ error: 'Pesan kosong.' }, 400);
    try {
      const r = await env.AI.run(model, { messages, max_tokens: 400, temperature: 0.2 });
      return json({ text: (r && r.response) || '' });
    } catch (e) {
      const msg = String((e && e.message) || e);
      return json({ error: msg }, /limit|quota|429|neuron|capacity/i.test(msg) ? 429 : 502);
    }
  },
};
