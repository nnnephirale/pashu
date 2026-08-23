// Session storage for Paper Image Shuffle.
//
// One R2 object per session. The app itself is served as static assets, and
// /s/<id> + /v/<id> fall through to index.html, which reads the id off the path.
const MAX_BYTES = 25 * 1024 * 1024;   // a session is settings + re-encoded images

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';   // no look-alikes
function newId(len = 10){
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/session' && request.method === 'POST'){
      const len = Number(request.headers.get('content-length') || 0);
      if (len > MAX_BYTES) return json({ error: 'Session too large' }, 413);

      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Malformed session' }, 400); }
      if (!body || typeof body !== 'object' || !body.settings)
        return json({ error: 'Malformed session' }, 400);

      const id = newId();
      await env.SESSIONS.put(`sessions/${id}.json`, JSON.stringify(body), {
        httpMetadata: { contentType: 'application/json' }
      });
      return json({ id });
    }

    const get = /^\/api\/session\/([a-z0-9]{4,40})$/.exec(pathname);
    if (get && request.method === 'GET'){
      const obj = await env.SESSIONS.get(`sessions/${get[1]}.json`);
      if (!obj) return json({ error: 'Session not found' }, 404);
      return new Response(obj.body, {
        headers: {
          'content-type': 'application/json',
          // sessions are immutable once written
          'cache-control': 'public, max-age=31536000, immutable'
        }
      });
    }

    if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    return env.ASSETS.fetch(request);
  }
};
