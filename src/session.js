// Session export/import.
//
// A session is the whole document: every control value, the canvas size, and
// the images. Demo images are stored by index rather than by bytes — they're
// already baked into the page, so a demo-only session is a couple of KB.
// Uploaded images are re-encoded to a sane size before travelling.
// The app can be served from GitHub Pages (static only), so the session API
// always points at the Worker by absolute URL rather than same-origin.
// Both are stamped by build.py.
const API_BASE = '__API_BASE__';
const APP_BASE = '__APP_BASE__';

const MAX_EDGE = 1800;
const JPEG_Q = 0.86;

function reencode(img){
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(1, MAX_EDGE / Math.max(iw, ih));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(iw * s));
  cv.height = Math.max(1, Math.round(ih * s));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', JPEG_Q);
}

export function serialize({ settings, size, photos }){
  return {
    v: 1,
    created: new Date().toISOString(),
    settings,
    size,
    images: photos.map(p => p.demo
      ? { d: p.demoIndex, on: p.on }
      : { u: reencode(p.img), on: p.on })
  };
}

export async function publish(session){
  const r = await fetch(API_BASE + '/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(session)
  });
  if (!r.ok) throw new Error(`publish failed (${r.status}) ${await r.text()}`);
  return r.json();                       // { id }
}

export async function load(id){
  const r = await fetch(`${API_BASE}/api/session/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(r.status === 404 ? 'Session not found' : `Load failed (${r.status})`);
  return r.json();
}

// Editable is s, play-only is v. Path form works on the Worker; query form works
// anywhere, including GitHub Pages under a project subpath, so that's what Share
// hands out.
export function routeOf(loc = location){
  const q = new URLSearchParams(loc.search);
  for (const [k, mode] of [['s', 'edit'], ['v', 'view']]){
    const id = q.get(k);
    if (id && /^[A-Za-z0-9_-]{4,40}$/.test(id)) return { mode, id };
  }
  const m = /^(?:.*)\/([sv])\/([A-Za-z0-9_-]{4,40})\/?$/.exec(loc.pathname);
  return m ? { mode: m[1] === 'v' ? 'view' : 'edit', id: m[2] } : null;
}

// Where a shared link should point. Served over the web, that's here; opened
// from a local file, fall back to the published app.
export function appBase(){
  if (location.protocol === 'http:' || location.protocol === 'https:')
    return location.origin + location.pathname.replace(/\/(index\.html)?$/, '/');
  return APP_BASE.replace(/\/?$/, '/');
}

export const canPublish = () => true;
