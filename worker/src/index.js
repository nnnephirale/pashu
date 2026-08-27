// Session storage for Paper Image Shuffle.
//
// One R2 object per session. The app itself is served as static assets, and
// /s/<id> + /v/<id> fall through to index.html, which reads the id off the path.
const MAX_BYTES = 25 * 1024 * 1024;   // a session is settings + re-encoded images

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';   // no look-alikes
function randomId(len){
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

// An id is public; the edit key is the capability to overwrite it. Only the hash
// is stored, so reading a session — or the bucket — never yields the key.
async function sha256(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// constant-time compare, so a wrong key can't be narrowed down by timing
function sameKey(a, b){
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The app may be served from GitHub Pages while the API stays here, so requests
// are cross-origin. Allowlisted rather than '*': there's no auth on this API, so
// there's no reason to invite arbitrary sites to write into the bucket.
const ALLOWED = [
  /^https:\/\/nnnephirale\.github\.io$/,
  /^https:\/\/paper-image-shuffle\.[a-z0-9-]+\.workers\.dev$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
];
function corsFor(request){
  const origin = request.headers.get('origin');
  // a local file:// page sends Origin: null — that's the double-clickable build
  if (origin === 'null') return { 'access-control-allow-origin': 'null' };
  if (origin && ALLOWED.some(re => re.test(origin)))
    return { 'access-control-allow-origin': origin, 'vary': 'origin' };
  return {};
}

const json = (data, status = 200, cors = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors }
});

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const { pathname } = url;
    const cors = corsFor(request);

    if (request.method === 'OPTIONS' && pathname.startsWith('/api/')){
      return new Response(null, { status: 204, headers: {
        ...cors,
        'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
        'access-control-allow-headers': 'content-type, x-edit-key',
        'access-control-max-age': '86400'
      }});
    }

    if (pathname === '/api/session' && request.method === 'POST'){
      const len = Number(request.headers.get('content-length') || 0);
      if (len > MAX_BYTES) return json({ error: 'Session too large' }, 413, cors);

      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Malformed session' }, 400, cors); }
      if (!body || typeof body !== 'object' || !body.settings)
        return json({ error: 'Malformed session' }, 400, cors);

      const id = randomId(10);
      const key = randomId(24);
      await env.SESSIONS.put(`sessions/${id}.json`, JSON.stringify(body), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { k: await sha256(key) }
      });
      return json({ id, key }, 200, cors);
    }

    // Overwrite in place — the id, and therefore the shared URL, never changes.
    const put = /^\/api\/session\/([a-z0-9]{4,40})$/.exec(pathname);
    if (put && request.method === 'PUT'){
      const len = Number(request.headers.get('content-length') || 0);
      if (len > MAX_BYTES) return json({ error: 'Session too large' }, 413, cors);

      const existing = await env.SESSIONS.head(`sessions/${put[1]}.json`);
      if (!existing) return json({ error: 'Session not found' }, 404, cors);

      const supplied = request.headers.get('x-edit-key') || '';
      const stored = (existing.customMetadata || {}).k || '';
      if (!stored || !sameKey(await sha256(supplied), stored))
        return json({ error: 'Not allowed to edit this session' }, 403, cors);

      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Malformed session' }, 400, cors); }
      if (!body || typeof body !== 'object' || !body.settings)
        return json({ error: 'Malformed session' }, 400, cors);

      await env.SESSIONS.put(`sessions/${put[1]}.json`, JSON.stringify(body), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { k: stored }
      });
      return json({ id: put[1], saved: true }, 200, cors);
    }

    const get = /^\/api\/session\/([a-z0-9]{4,40})$/.exec(pathname);
    if (get && request.method === 'GET'){
      const obj = await env.SESSIONS.get(`sessions/${get[1]}.json`);
      if (!obj) return json({ error: 'Session not found' }, 404, cors);
      return new Response(obj.body, {
        headers: {
          'content-type': 'application/json',
          // sessions can be overwritten in place, so they can't be cached hard
          'cache-control': 'public, max-age=0, must-revalidate',
          ...cors
        }
      });
    }

    if (pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404, cors);
    return env.ASSETS.fetch(request);
  }
};
