// Cloudflare Worker: serves the static app in ./public, a small AI endpoint for the Asisten, and /api/mesin
// (optional copy of the machine master in Workers KV).
// /api/ask runs a Workers AI model in this Cloudflare account. On the Workers Free plan the daily
// free allowance simply runs out (requests get an error until the next day); nothing is billed.
// On a Workers Paid plan, usage beyond the free allowance is billed, so keep an eye on it there.
const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const ROLES = ['system', 'user', 'assistant'];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

// /api/mesin keeps one JSON document: machine codes, numbers and AES-GCM ciphertext of the real names. The key is a
// passphrase the planner types in the browser; it never reaches this Worker, so a leak of KV shows no real names.
// Needs a KV binding named MESIN_DB (see wrangler.jsonc); without it the endpoint answers 503 and the app keeps
// the master in the browser and the history file only.
const MESIN_KEY = 'mesin-master';
const MESIN_MAX = 256 * 1024;
function validMesinDoc(d) {
  if (!d || d.v !== 1 || !Array.isArray(d.master) || !d.mkey || typeof d.mkey.salt !== 'string' || !d.mkey.chk) return false;
  // every machine must carry an encrypted name: the app refuses to send codes that may still be real names
  return d.master.every((g) => Array.isArray(g) && typeof g[0] === 'string' && Array.isArray(g[1]) &&
    g[1].every((m) => Array.isArray(m) && typeof m[0] === 'string' && m[0].length <= 40 && m[3] && m[3].enc && typeof m[3].enc.ct === 'string'));
}
async function mesin(request, env, url) {
  if (!env.MESIN_DB) return json({ error: 'Penyimpanan server (KV MESIN_DB) belum diaktifkan.' }, 503);
  if (request.method === 'GET') { const doc = await env.MESIN_DB.get(MESIN_KEY, 'json'); return json({ doc: doc || null }); }
  if (request.method !== 'PUT') return json({ error: 'Metode tidak didukung.' }, 405);
  const origin = request.headers.get('origin');
  if (!origin || new URL(origin).host !== url.host) return json({ error: 'Asal permintaan tidak diizinkan.' }, 403);
  const text = await request.text();
  if (text.length > MESIN_MAX) return json({ error: 'Data terlalu besar.' }, 413);
  let doc;
  try { doc = JSON.parse(text); } catch { return json({ error: 'Body bukan JSON.' }, 400); }
  if (!validMesinDoc(doc)) return json({ error: 'Format master mesin tidak valid (semua mesin wajib punya nama terenkripsi).' }, 400);
  await env.MESIN_DB.put(MESIN_KEY, JSON.stringify(doc));
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/mesin') return mesin(request, env, url);
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
