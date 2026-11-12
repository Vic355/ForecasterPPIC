// Cloudflare Worker: serves the static app in ./public and a small AI endpoint for the Asisten.
// /api/ask runs a Workers AI model in this Cloudflare account. On the Workers Free plan the daily
// free allowance simply runs out (requests get an error until the next day); nothing is billed.
// On a Workers Paid plan, usage beyond the free allowance is billed, so keep an eye on it there.
const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const ROLES = ['system', 'user', 'assistant'];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
