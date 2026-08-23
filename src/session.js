// Session export/import.
//
// A session is the whole document: every control value, the canvas size, and
// the images. Demo images are stored by index rather than by bytes — they're
// already baked into the page, so a demo-only session is a couple of KB.
// Uploaded images are re-encoded to a sane size before travelling.
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
  const r = await fetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(session)
  });
  if (!r.ok) throw new Error(`publish failed (${r.status}) ${await r.text()}`);
  return r.json();                       // { id }
}

export async function load(id){
  const r = await fetch(`/api/session/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(r.status === 404 ? 'Session not found' : `Load failed (${r.status})`);
  return r.json();
}

// /s/<id> is editable, /v/<id> plays only. Anything else is a fresh app.
export function routeOf(pathname){
  const m = /^\/([sv])\/([A-Za-z0-9_-]{4,40})\/?$/.exec(pathname);
  return m ? { mode: m[1] === 'v' ? 'view' : 'edit', id: m[2] } : null;
}

export const canPublish = () => location.protocol === 'http:' || location.protocol === 'https:';
