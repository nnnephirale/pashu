import * as C from './controls.js';
import { hash, shash, clamp, easeOutCubic, easeInOutCubic, mulberry32 } from './rng.js';
import * as P from './paper.js';
import * as F from './folds.js';
import * as IMP from './imperfections.js';
import * as SESSION from './session.js';
import * as CUT from './cutout.js';

const BUILD = '__BUILD__';
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const printBuf = document.createElement('canvas');
const pbx = printBuf.getContext('2d');

const DEMO = Array.from({ length: 12 }, (_, i) => `assets/demo/demo_${i+1}.jpg`);
const PAPERS = Array.from({ length: 9 }, (_, i) => `assets/paper/web/paper_${i}.jpg`);

let photos = [];            // {src, img, on}
let papers = [];            // {src, img, on}
let paperSamplers = new Map();

// ── control schema ───────────────────────────────────────────────────────────
const photoStrip = document.createElement('div');
photoStrip.className = 'thumbs';
const paperStrip = document.createElement('div');
paperStrip.className = 'thumbs';
const photoHint = document.createElement('div');
photoHint.className = 'hint';
photoHint.textContent = 'Click to mute · drag images anywhere to add';

const schema = [
  { type:'segmented', key:'mode', label:'', default:'both', cls:'mode-bar', options:[
      {id:'both',label:'Randomized'},{id:'sweep',label:'Sequential'}] },

  { type:'section', label:'Images', collapsed:false },
  { type:'custom', render:() => photoStrip },
  { type:'custom', render:() => photoHint },
  { type:'buttons', buttons:[{key:'addPhotos',label:'Add'},{key:'resetPhotos',label:'Demo set'},
                             {key:'clearPhotos',label:'Clear',danger:true}] },
  { type:'segmented', key:'imageFit', label:'Fit', default:'sheet', options:[
      {id:'sheet',label:'Sheet'},{id:'panel',label:'Panel'}] },
  { type:'segmented', key:'shuffleMode', label:'Next Image', default:'random', options:[
      {id:'random',label:'Any'},{id:'sequential',label:'In Order'}] },
  { type:'slider', key:'holdFrames', label:'Hold', min:1, max:30, step:1, default:3, unit:'f' },
  { type:'slider', key:'holdJitter', label:'Hold Jitter', min:0, max:1, step:0.05, default:0.6 },
  { type:'slider', key:'swapChance', label:'Swap Chance', min:0, max:1, step:0.05, default:0.55 },
  { type:'select', key:'printBlend', label:'Print Blend', default:'multiply', options:[
      {id:'source-over',label:'Normal'},{id:'multiply',label:'Multiply'},
      {id:'darken',label:'Darken'},{id:'overlay',label:'Overlay'}] },
  { type:'slider', key:'printOpacity', label:'Print Opacity', min:0, max:1, step:0.01, default:0.94 },
  { type:'slider', key:'printScale', label:'Print Scale', min:0.5, max:2.5, step:0.01, default:1 },

  { type:'section', label:'Collage Cutout', collapsed:false },
  { type:'toggle', key:'cutout', label:'Cut out subjects', default:true },
  { type:'toggle', key:'imageBg', label:'Image background', default:false },
  { type:'slider', key:'subjectScale', label:'Subject Size', min:0.2, max:4, step:0.01, default:0.72 },
  { type:'slider', key:'subjectX', label:'Position X', min:-1, max:1, step:0.01, default:0 },
  { type:'slider', key:'subjectY', label:'Position Y', min:-1, max:1, step:0.01, default:0 },
  { type:'slider', key:'edgeWidth', label:'Paper Edge', min:0, max:40, step:0.5, default:11, unit:'px' },
  { type:'slider', key:'edgeRough', label:'Edge Tear', min:0, max:1, step:0.02, default:0.6 },
  { type:'slider', key:'pieceShadow', label:'Cutout Shadow', min:0, max:1, step:0.02, default:0.35 },
  { type:'buttons', buttons:[{key:'cutoutAll',label:'Cut out all'}] },

  { type:'section', label:'Paper & Environment', collapsed:true },
  { type:'custom', render:() => paperStrip },
  { type:'segmented', key:'paperSwapMode', label:'Paper', default:'perimage', options:[
      {id:'single',label:'One Paper'},{id:'perimage',label:'Per Image'}] },
  { type:'slider', key:'paperScale', label:'Paper Scale', min:0.5, max:3, step:0.05, default:1.15 },
  { type:'slider', key:'paperDistortion', label:'Paper Distortion', min:0, max:3, step:0.05, default:0.9 },
  { type:'slider', key:'paperLighting', label:'Paper Lighting', min:0, max:2, step:0.05, default:0.85 },
  { type:'slider', key:'lightingContrast', label:'Lighting Contrast', min:0, max:2, step:0.05, default:1 },

  { type:'section', label:'Animation & Stop-Motion', collapsed:false },
  { type:'slider', key:'fps', label:'FPS', min:1, max:30, step:1, default:6 },
  { type:'slider', key:'gifSampleFps', label:'GIF Frames/s', min:1, max:30, step:1, default:8 },
  { type:'slider', key:'tileBeat', label:'Tile Beat', min:1, max:12, step:1, default:1, unit:'f' },
  { type:'slider', key:'sweepHold', label:'Sweep Hold', min:0, max:40, step:1, default:6, unit:'f' },
  { type:'select', key:'entry', label:'Entry', default:'snap', options:[
      {id:'snap',label:'Snap'},{id:'fade',label:'Fade'},{id:'slide',label:'Slide'},
      {id:'grow',label:'Grow'}] },
  { type:'slider', key:'entryFrames', label:'Entry Length', min:0, max:12, step:1, default:2, unit:'f' },
  { type:'toggle', key:'loop', label:'Loop', default:true },

  { type:'section', label:'Analog Imperfections', collapsed:false },
  { type:'slider', key:'posJitter', label:'Position Jitter', min:0, max:20, step:0.5, default:3, unit:'px' },
  { type:'slider', key:'rotJitter', label:'Rotation Jitter', min:0, max:8, step:0.1, default:0.9, unit:'°' },
  { type:'slider', key:'unevenness', label:'Print Unevenness', min:0, max:1, step:0.01, default:0.22 },
  { type:'slider', key:'cameraShake', label:'Camera Shake', min:0, max:12, step:0.1, default:1.2 },
  { type:'slider', key:'filmGrain', label:'Film Grain', min:0, max:1, step:0.01, default:0.07 },
  { type:'slider', key:'vignette', label:'Vignette', min:0, max:1, step:0.01, default:0.22 },
  { type:'slider', key:'seed', label:'Seed', min:1, max:9999, step:1, default:2301 },
  { type:'buttons', buttons:[{key:'reroll',label:'Reroll seed'},{key:'resetAll2',label:'Reset all',danger:true}] }
];

C.build(schema, document.getElementById('controls'));

// This is the whole-image clone: every picture fills the sheet, with no fold
// grid dividing it. The render engine still reads the segment and crease
// parameters, so pin them to neutral values that collapse the grid to a single
// full-frame cell and switch every fold/ridge effect off.
const WHOLE_FRAME = {
  cols: 1, rows: 1, grouping: 0, groupCap: 1, coverage: 1,
  gridJitter: 0, foldWaver: 0, foldSkew: 0, tear: 0, panelOffset: 0, panelRotate: 0,
  panelTone: 0, creaseHighlight: 0, creaseShadow: 0, creaseWidth: 1, creaseSoft: 0,
  creaseVary: 0, panelLift: 0, lightAngle: 305,
  revealOrder: 'reading', revealStagger: 0, revealDuration: 0.1, debugTiles: false,
};
for (const k in WHOLE_FRAME) C.set(k, WHOLE_FRAME[k]);

C.onAny(() => { dirty = true; });

// ── image handling ───────────────────────────────────────────────────────────
function renderStrip(strip, list, onToggle, onRemove){
  strip.innerHTML = '';
  if (!list.length){
    const e = document.createElement('div');
    e.className = 'strip-empty';
    e.textContent = 'No images — drop some in, or load the demo set';
    strip.appendChild(e);
    return;
  }
  list.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'thumb' + (it.on ? '' : ' off');
    // Hover shows the on-disk filename (e.g. paper_3.png) so it's clear which
    // base file to edit. Only meaningful for the linked assets, not uploads.
    const file = /\/assets\//.test(it.src) ? it.src.split('?')[0].split('/').pop() : '';
    if (file) d.title = file;
    d.innerHTML = `<img src="${it.src}" alt=""><span class="x">×</span>`;
    d.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); onRemove(i); });
    d.addEventListener('click', () => onToggle(i));
    strip.appendChild(d);
  });
}
const refreshStrips = () => {
  dirty = true;
  syncSaveBtn();
  // the empty state already says how to add images — don't say it twice
  photoHint.style.display = photos.length ? '' : 'none';
  renderStrip(photoStrip, photos,
    i => { photos[i].on = !photos[i].on; refreshStrips(); resetTimeline(); },
    i => {
      const [gone] = photos.splice(i, 1);
      // deleting a placeholder by hand is a dismissal too — don't resurrect it
      if (gone && gone.demo) C.setExtra('demoDismissed', true);
      refreshStrips(); resetTimeline();
    });
  renderStrip(paperStrip, papers,
    i => { papers[i].on = !papers[i].on; refreshStrips(); },
    i => { papers.splice(i, 1); refreshStrips(); });
};

async function addSources(list, srcs, demo = false){
  let added = 0;
  for (const src of srcs){
    try {
      const img = await P.loadImage(src);
      const e = { src, img, on: true, demo };
      if (demo) e.demoIndex = DEMO.indexOf(src);
      list.push(e); added++;
    }
    catch { /* skip */ }
  }
  refreshStrips();
  return added;
}

// The demo images are placeholders. The moment the user brings their own, the
// placeholders go and stay gone — including across refreshes, so a reload never
// resurrects images they deliberately replaced.
async function addUserPhotos(files){
  const hadDemo = photos.some(p => p.demo);
  if (hadDemo) photos = photos.filter(p => !p.demo);
  const before = photos.length;
  let n = 0;
  for (const f of files){
    try {
      const src = URL.createObjectURL(f);
      const img = await P.loadImage(src);
      // A GIF is kept as its live, animating <img> and plays whole — no cutout.
      const entry = { src, img, on: true, demo: false, isGif: f.type === 'image/gif' };
      photos.push(entry);
      // Decode the GIF's frames so it can play deterministically on our clock —
      // a detached <img> doesn't animate reliably. Runs in the background; until
      // it lands, the first frame (entry.img) shows.
      if (entry.isGif)
        decodeGif(f).then(g => { if (g){ entry.gif = g; entry._piece = null; dirty = true; } })
                    .catch(() => {});
      n++;
    } catch { /* skip unreadable files */ }
  }
  refreshStrips();
  C.setExtra('demoDismissed', true);
  // Match the sheet to the (first) added image exactly, so a pasted/uploaded
  // picture defines the output size.
  const firstNew = photos[before];
  if (firstNew && firstNew.img){
    const iw = firstNew.img.naturalWidth || firstNew.img.width;
    const ih = firstNew.img.naturalHeight || firstNew.img.height;
    if (iw && ih){
      sizeW.value = clamp(iw, 120, 4000); sizeH.value = clamp(ih, 120, 4000);
      sizePreset.value = 'custom'; applySize();
    }
  }
  resetTimeline();
  if (!n) toast('Could not read those files');
  else toast(hadDemo ? `${n} added · placeholders cleared` : `${n} added`);
  // Cut out the still images (GIFs animate as-is, so they're skipped).
  if (C.get('cutout'))
    for (const p of photos.slice(before)) if (!p.isGif) processCutout(p);
}

const activePhotos = () => photos.filter(p => p.on);
const activePapers = () => papers.filter(p => p.on);

function samplerFor(entry){
  if (!entry) return null;
  if (!paperSamplers.has(entry.img)) paperSamplers.set(entry.img, P.buildSampler(entry.img));
  return paperSamplers.get(entry.img);
}

// ── timeline ─────────────────────────────────────────────────────────────────
let frame = 0, accum = 0, lastTs = 0, playing = true;
// The animation is quantized to `fps`, so at the default 6fps a 60Hz redraw would
// throw away nine frames in ten. Draw only when a beat lands or a control moves.
let dirty = true;
// off by default; the debug handle flips it on to record what each frame drew
let trace = false, drawn = [];
let drawnThisFrame = [];
let segments = [];          // per panel: {cur, prev, lastSwap, entryAt}
let paperIndex = 0;
let grid = null, gridKey = '', blocks = [];

function resetTimeline(){ frame = 0; accum = 0; paperIndex = 0; segments = []; dirty = true; }

function ensureSegments(n){
  if (segments.length === n) return;
  segments = Array.from({ length: n }, (_, i) => ({
    cur: i % Math.max(1, activePhotos().length), prev: -1, lastSwap: -999, entryAt: -999
  }));
}

// Reveal schedule: when each panel first appears during assembly.
function revealFrameFor(p, cols, rows, total, fps, seed){
  const order = C.get('revealOrder');
  const stagger = C.get('revealStagger');
  const dur = C.get('revealDuration') * fps;
  let t;
  if (order === 'reading')      t = total > 1 ? p.id / (total - 1) : 0;
  else if (order === 'columns') t = cols > 1 ? p.i / (cols - 1) : 0;
  else if (order === 'centre'){
    const dx = (p.i + 0.5) / cols - 0.5, dy = (p.j + 0.5) / rows - 0.5;
    t = clamp(Math.hypot(dx, dy) / 0.72, 0, 1);
  } else t = hash(seed, p.id, 71);
  return t * stagger * dur;
}

function advance(){
  frame++;
  const seed = C.get('seed');
  // Paper selection happens in render(): "One Paper" holds; "Per Image" picks a
  // fresh un-muted paper whenever the shown subject changes.

  // segment shuffling
  const n = activePhotos().length;
  const runMode = C.get('mode');
  const shuffles = runMode === 'shuffle' || runMode === 'both';
  if (shuffles && n > 1 && grid && blocks.length){
    const hold = C.get('holdFrames');
    const hj = C.get('holdJitter');
    const chance = C.get('swapChance');
    const fps = C.get('fps');
    const assembleEnd = runMode === 'both' ? assemblyLength(fps) : 0;
    if (frame >= assembleEnd){
      segments.forEach((s, i) => {
        const wait = Math.max(1, Math.round(hold * (1 - hj * 0.5 + hash(seed, i * 13 + frame, 81) * hj)));
        if (frame - s.lastSwap < wait) return;
        if (hash(seed, i * 7 + frame, 83) > chance){ s.lastSwap = frame; return; }
        let next;
        if (C.get('shuffleMode') === 'sequential') next = (s.cur + 1) % n;
        else {
          next = Math.floor(hash(seed, i * 29 + frame, 89) * n);
          if (next === s.cur) next = (next + 1) % n;
        }
        s.prev = s.cur; s.cur = next; s.lastSwap = frame; s.entryAt = frame;
      });
    }
  }

  if (C.get('loop') && grid){
    const fps = C.get('fps');
    const len = assemblyLength(fps) + Math.round(fps * 1.4);
    if (runMode === 'assemble' && frame >= len) resetTimeline();
  }
}

// Sweep needs a strict laying ORDER, not the normalised 0..1 offset the
// assemble reveal uses — tile 5 must land after tile 4 and before tile 6.
function assignSweepRanks(){
  const order = C.get('mode') === 'sweep' ? 'reading' : C.get('revealOrder');
  const seed = C.get('seed');
  const arr = blocks.slice();
  if (order === 'columns') arr.sort((a, b) => (a.i - b.i) || (a.j - b.j));
  else if (order === 'centre'){
    const d = (b) => Math.hypot((b.cx / grid.w) - 0.5, (b.cy / grid.h) - 0.5);
    arr.sort((a, b) => d(a) - d(b));
  }
  else if (order === 'scattered')
    arr.sort((a, b) => hash(seed, a.id, 71) - hash(seed, b.id, 71));
  // 'reading' is already the order buildBlocks sorts into: row by row, then down
  arr.forEach((b, k) => { b.rank = k; });
}

function assemblyLength(fps){
  if (!grid) return 0;
  let m = 0;
  for (const b of blocks)
    m = Math.max(m, revealFrameFor(b, grid.cols, grid.rows, blocks.length, fps, C.get('seed')));
  return m + C.get('entryFrames') + 1;
}

// How many frames make up "one full animation" — the count the PNG export walks.
// Sequential has an exact period (every image laid down once, then it repeats).
// Randomized never repeats — it assembles, then jitters forever — so we take the
// assembly plus a tail of shuffle frames long enough to read as one full cycle.
function loopLength(){
  const fps = C.get('fps');
  if (C.get('mode') === 'sweep'){
    const n = Math.max(1, activePhotos().length);
    const cycleLen = blocks.length + C.get('sweepHold');
    return Math.max(1, n * cycleLen * C.get('tileBeat'));
  }
  const tail = Math.max(Math.round(fps * 2), C.get('holdFrames') * 4);
  return Math.max(1, Math.ceil(assemblyLength(fps)) + tail);
}

// ── drawing ──────────────────────────────────────────────────────────────────
function drawBlockPanel(g, b, p, entry, alpha, sc, dx, dy, cw, ch, rotJit = 0){
  const list = activePhotos();
  if (!list.length) return;
  const photo = list[clamp(entry, 0, list.length - 1)];
  const img = photo.isGif ? currentGifFrame(photo) : photo.img;
  const fit = C.get('imageFit');
  const ps = C.get('printScale');
  pbx.save();
  pbx.globalAlpha = alpha;
  // Transform BEFORE clipping, so the tile's aperture moves with its content.
  // Clip first and the image merely slides under a fixed window — every tile
  // then reads as one rigid sheet. Moving both is what makes each tile look
  // like its own scrap of paper, with the small gaps and overlaps to match.
  pbx.translate(p.cx + dx, p.cy + dy);
  pbx.rotate((p.rot * C.get('panelRotate') + rotJit) * Math.PI / 180);
  pbx.scale(sc, sc);
  pbx.translate(-p.cx, -p.cy);
  pbx.clip(F.panelPath(g, p, C.get('tear'), 0.75));
  if (fit === 'sheet'){
    const w = cw * ps, h = ch * ps;
    P.drawCover(pbx, img, (cw - w) / 2, (ch - h) / 2, w, h);
  } else {
    const w = b.w * ps * 1.04, h = b.h * ps * 1.04;
    P.drawCover(pbx, img, b.cx - w / 2, b.cy - h / 2, w, h);
  }
  pbx.restore();
}

// ── collage cutout ────────────────────────────────────────────────────────────
// Cut-out subjects are laid on the paper like scraps of a paper collage: a torn
// white paper border baked around the subject's silhouette, then a drop shadow
// when it's placed. The heavy background removal lives in cutout.js; here we
// only compose what it returns.
const collageMode = () => !!C.get('cutout') && activePhotos().length > 0;

// Decode an animated GIF into per-frame canvases + cumulative timing, using the
// browser's ImageDecoder (Chromium/WebKit-recent). Returns null if unsupported
// or not actually animated, in which case the still first frame is used.
async function decodeGif(file){
  if (typeof ImageDecoder === 'undefined') return null;
  try {
    const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    const count = track && track.frameCount ? track.frameCount : 0;
    const frames = [], cum = []; let total = 0;
    for (let i = 0; count ? i < count : i < 512; i++){
      let res;
      try { res = await dec.decode({ frameIndex: i }); }
      catch { break; }                       // ran past the last frame
      const img = res.image;
      const c = document.createElement('canvas');
      c.width = img.displayWidth || img.codedWidth;
      c.height = img.displayHeight || img.codedHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      total += (img.duration || 100000) / 1000;   // microseconds → ms
      img.close();
      frames.push(c); cum.push(total);
    }
    dec.close();
    return frames.length > 1 ? { frames, cum, total } : null;
  } catch { return null; }
}

// Resample a decoded GIF to "GIF Frames/s" evenly-spaced stills across its real
// duration, and pick the still for the current beat. `k` is the still index (for
// per-image paper), `frame` the canvas to draw. One still advances per beat, so
// it reads as stop-motion — like flipping through uploaded stills.
function gifStill(g){
  const sfps = C.get('gifSampleFps') || 8;
  const count = Math.max(1, Math.round((g.total / 1000) * sfps));
  const k = ((frame % count) + count) % count;
  const t = (k + 0.5) * (g.total / count);          // midpoint time of this still
  let i = 0; while (i < g.cum.length - 1 && t >= g.cum[i]) i++;
  return { k, count, canvas: g.frames[i] };
}
function currentGifFrame(photo){
  const g = photo.gif;
  if (!g || !g.frames.length) return photo.img;
  return gifStill(g).canvas;
}

let cutModelWarned = false;
async function processCutout(photo){
  if (!photo || photo.cutout || photo._cutting || photo.cutFailed || photo.isGif) return;
  photo._cutting = true; refreshStrips();
  try {
    const { canvas: cut, bbox, coverage } = await CUT.cutout(photo.src, (frac) =>
      toast(`Loading cutout model… ${Math.round(frac * 100)}%`));
    // Too little survived the clean-up — there's no clear subject in this image
    // (a flat scene, a busy layout). Keep the whole image rather than laying
    // down a torn scrap of noise.
    if (coverage < 0.012){
      photo.cutFailed = true;
      toast('No clear subject — keeping full image');
    } else {
      photo.cutout = cut; photo.bbox = bbox; photo.cutFailed = false;
      photo.cutStamp = (photo.cutStamp || 0) + 1;   // invalidate the piece cache
      photo._piece = null;
      toast('Subject cut out');
    }
  } catch (err){
    console.error('cutout failed', err);
    if (!cutModelWarned){
      toast('Cutout unavailable (offline?) — showing full image');
      cutModelWarned = true;
    }
  } finally {
    photo._cutting = false; refreshStrips(); dirty = true;
  }
}

async function cutoutAll(){
  const todo = activePhotos().filter(p => !p.cutout && !p._cutting && !p.cutFailed);
  if (!todo.length){ toast('Nothing to cut out'); return; }
  for (const p of todo) await processCutout(p);   // one at a time — one model, shared
}

const clampi = (v, a, b) => v < a ? a : v > b ? b : v;

// Separable box blur of a single-channel (alpha) field. Used as a cheap
// distance-from-edge ramp: after blurring, a pixel's value falls off smoothly
// with how far it sits outside the subject's silhouette.
function boxBlurAlpha(A, W, H, r){
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const win = 2 * r + 1;
  for (let y = 0; y < H; y++){
    const row = y * W; let sum = 0;
    for (let x = -r; x <= r; x++) sum += A[row + clampi(x, 0, W - 1)];
    for (let x = 0; x < W; x++){
      tmp[row + x] = sum / win;
      sum += A[row + clampi(x + r + 1, 0, W - 1)] - A[row + clampi(x - r, 0, W - 1)];
    }
  }
  for (let x = 0; x < W; x++){
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[clampi(y, 0, H - 1) * W + x];
    for (let y = 0; y < H; y++){
      out[y * W + x] = sum / win;
      sum += tmp[clampi(y + r + 1, 0, H - 1) * W + x] - tmp[clampi(y - r, 0, H - 1) * W + x];
    }
  }
  return out;
}

// Smooth value noise in [0,1] at a given cell size (smoothstep-interpolated
// random lattice). Low cell = fine serrations; high cell = slow fat/thin drift.
function valueNoise(W, H, seed, cell){
  const gw = Math.ceil(W / cell) + 2, gh = Math.ceil(H / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) g[i] = hash(seed, i, 17);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++){
    const gy = y / cell, j0 = Math.floor(gy), fy = gy - j0, sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < W; x++){
      const gx = x / cell, i0 = Math.floor(gx), fx = gx - i0, sx = fx * fx * (3 - 2 * fx);
      const a = g[j0 * gw + i0], b = g[j0 * gw + i0 + 1];
      const c = g[(j0 + 1) * gw + i0], d = g[(j0 + 1) * gw + i0 + 1];
      const top = a + (b - a) * sx, bot = c + (d - c) * sx;
      out[y * W + x] = top + (bot - top) * sy;
    }
  }
  return out;
}

// A hand-cut paper backing for the subject in `sub`. Rather than a uniform
// outline, the white margin follows a blurred version of the silhouette and is
// kept only where that ramp clears a threshold that DRIFTS along the outline via
// noise — so the paper sticks out fat in places, sits tight to the subject in
// others, with the occasional nick, the way a real scissored cut-out looks when
// it's photographed.
function paperBacking(sub, W, H, ew, er, seed){
  const A = new Float32Array(W * H);
  const src = sub.getContext('2d').getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) A[i] = src[i * 4 + 3];

  const B = boxBlurAlpha(A, W, H, Math.max(1, Math.round(ew)));
  const nLow = valueNoise(W, H, seed, Math.max(36, ew * 9));       // slow fat/thin sweeps
  const nHi = valueNoise(W, H, seed * 3 + 1, Math.max(6, ew * 2)); // gentle serration

  const out = new Uint8ClampedArray(W * H * 4);
  const base = 70;              // ~how far the white sits out from the true edge
  const amp = 150 * er;         // how wildly the margin wanders (0 = uniform)
  for (let i = 0; i < W * H; i++){
    const n = 0.78 * nLow[i] + 0.22 * nHi[i];
    const t = base + amp * (n - 0.5);
    out[i * 4] = 246; out[i * 4 + 1] = 242; out[i * 4 + 2] = 232;
    out[i * 4 + 3] = B[i] >= t ? 255 : 0;
  }
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
  return c;
}

// Bake the subject + torn white border into a standalone canvas, cached per
// photo and per edge setting. With no cutout yet, the whole image becomes a
// rectangular paper card so the collage still reads while the model runs.
function getPiece(photo){
  const ew = C.get('edgeWidth'), er = C.get('edgeRough');
  const key = `${ew}|${er}|${photo.cutStamp || 0}`;
  // A GIF's <img> keeps advancing, so its piece must be rebuilt each frame to
  // capture the current frame — the torn edge is stable (same seed), only the
  // content changes. Still images stay cached.
  if (photo._piece && photo._pieceKey === key && !photo.isGif) return photo._piece;

  const m = Math.ceil(ew * (1 + er) + 6);
  let W, H, drawSub;
  if (photo.cutout){
    const bb = photo.bbox;
    W = bb.w + 2 * m; H = bb.h + 2 * m;
    drawSub = (c) => c.drawImage(photo.cutout, m - bb.x, m - bb.y);
  } else {
    // GIFs draw their current decoded frame; still images draw their <img>.
    const im = photo.isGif ? currentGifFrame(photo) : photo.img;
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    W = iw + 2 * m; H = ih + 2 * m;
    drawSub = (c) => c.drawImage(im, m, m);
  }

  const piece = document.createElement('canvas');
  piece.width = W; piece.height = H;
  const pc = piece.getContext('2d');

  if (ew > 0.5){
    // draw the subject to its own buffer, read its alpha, grow a torn white
    // paper backing from it, then lay the subject back on top
    const seedFor = (photo._seed ||= 1 + Math.floor(Math.random() * 9998));
    const sub = document.createElement('canvas');
    sub.width = W; sub.height = H;
    drawSub(sub.getContext('2d'));
    pc.drawImage(paperBacking(sub, W, H, ew, er, seedFor), 0, 0);
  }
  drawSub(pc);

  photo._piece = piece; photo._pieceKey = key;
  return piece;
}

function drawCollage(ctx, cw, ch, seed){
  const list = activePhotos();
  if (!list.length) return;
  const st = segments[0];
  const idx = clamp(st ? st.cur : 0, 0, list.length - 1);
  const piece = getPiece(list[idx]);
  if (!piece) return;

  const entryFrames = C.get('entryFrames'), entryKind = C.get('entry');
  const since = Math.max(frame - (st ? st.entryAt : 0), 0);
  const ee = easeOutCubic(entryFrames > 0 ? clamp(since / entryFrames, 0, 1) : 1);
  let alpha = 1, grow = 1, ex = 0, ey = 0;
  if (entryKind === 'fade') alpha = ee;
  else if (entryKind === 'grow'){ alpha = ee; grow = 0.82 + 0.18 * ee; }
  else if (entryKind === 'slide'){ alpha = Math.min(1, ee * 1.4); ey = (1 - ee) * ch * 0.12; }

  const target = C.get('subjectScale') * Math.min(cw, ch);
  const s = grow * target / Math.max(piece.width, piece.height);
  const jx = shash(seed, idx * 3 + frame, 51) * C.get('posJitter');
  const jy = shash(seed, idx * 3 + frame, 52) * C.get('posJitter');
  const jr = shash(seed, idx * 5 + frame, 56) * C.get('rotJitter') * Math.PI / 180;

  drawnThisFrame = [[0, idx]];
  ctx.save();
  ctx.globalAlpha = alpha;
  const shd = C.get('pieceShadow');
  if (shd > 0){
    ctx.shadowColor = `rgba(28,22,18,${0.55 * shd})`;
    ctx.shadowBlur = 22 * shd * (Math.min(cw, ch) / 1000);
    ctx.shadowOffsetX = 5 * shd; ctx.shadowOffsetY = 9 * shd;
  }
  ctx.translate(cw / 2 + ex + jx + C.get('subjectX') * cw / 2,
                ch / 2 + ey + jy + C.get('subjectY') * ch / 2);
  ctx.rotate(jr);
  ctx.scale(s, s);
  ctx.drawImage(piece, -piece.width / 2, -piece.height / 2);
  ctx.restore();
}

// Which subject is on screen right now — so "Per Image" paper changes in step
// with it. Sequential: the sweep's current cycle. Randomized: the current image.
// A GIF counts each of its frames as its own "image", so the paper can change
// per frame just like it does per uploaded still.
function currentImageId(){
  const list = activePhotos();
  let base, photo;
  if (C.get('mode') === 'sweep'){
    const tileBeat = C.get('tileBeat');
    const step = C.get('entry') === 'snap'
      ? Math.max(1, tileBeat) : Math.max(1, tileBeat, C.get('entryFrames'));
    const cycleLen = Math.max(1, blocks.length + C.get('sweepHold'));
    base = Math.floor(Math.floor(frame / step) / cycleLen);
    photo = list.length ? list[((base % list.length) + list.length) % list.length] : null;
  } else {
    base = segments[0] ? segments[0].cur : 0;
    photo = list[clamp(base, 0, Math.max(0, list.length - 1))];
  }
  if (photo && photo.isGif && photo.gif)
    return base * 100000 + gifStill(photo.gif).k;     // distinct id per sampled still
  return base;
}

function render(){
  const cw = canvas.width, ch = canvas.height;
  const fps = C.get('fps');
  const seed = C.get('seed');
  const runMode = C.get('mode');
  const cols = C.get('cols'), rows = C.get('rows');
  // Sweep lays one image per grid cell. Merged blocks would span rows, so a
  // block anchored in row 0 would fill part of row 1 before row 0 finished —
  // which breaks the row-by-row read the mode exists to produce.
  const sweepMode = runMode === 'sweep';
  const grouping = sweepMode ? 0 : C.get('grouping');
  const groupCap = sweepMode ? 1 : C.get('groupCap');
  const key = [cols, rows, cw, ch, seed, C.get('gridJitter'), C.get('foldWaver'),
               C.get('foldSkew'), grouping, groupCap,
               sweepMode ? 'reading' : C.get('revealOrder')].join('|');
  if (key !== gridKey){
    grid = F.buildGrid({ cols, rows, w: cw, h: ch, seed,
      gridJitter: C.get('gridJitter'), foldWaver: C.get('foldWaver'), foldSkew: C.get('foldSkew') });
    blocks = F.buildBlocks(grid, seed, grouping, groupCap);
    assignSweepRanks();
    gridKey = key;
  }
  ensureSegments(blocks.length);

  const lightAngle = C.get('lightAngle') * Math.PI / 180;
  const ap = activePapers();
  // Paper: "One Paper" holds the current (first un-muted) sheet; "Per Image"
  // maps each shown subject to one of the un-muted papers, so the sheet changes
  // whenever the subject does.
  if (ap.length){
    if (C.get('paperSwapMode') === 'perimage'){
      const imgId = currentImageId();
      paperIndex = Math.floor(hash(seed, imgId + 1, 55) * ap.length) % ap.length;
    }
    paperIndex = Math.min(paperIndex, ap.length - 1);
  }
  const paper = ap.length ? ap[paperIndex] : null;
  const sampler = samplerFor(paper);

  // ---- printed layer -------------------------------------------------------
  if (printBuf.width !== cw || printBuf.height !== ch){ printBuf.width = cw; printBuf.height = ch; }
  pbx.clearRect(0, 0, cw, ch);

  const entryFrames = C.get('entryFrames');
  const entryKind = C.get('entry');
  const posJ = C.get('posJitter'), rotJ = C.get('rotJitter');
  const pOff = C.get('panelOffset');

  const coverage = runMode === 'sweep' ? 1 : C.get('coverage');
  const covered = (b) => coverage >= 0.999 || hash(seed, b.id, 111) <= coverage;
  drawnThisFrame = [];
  if (trace) drawn = [];

  if (runMode === 'sweep'){
    // One image lays itself down tile by tile in strict order. Only when the
    // LAST tile has landed (plus a hold) does the next image start over the top.
    const n = activePhotos().length;
    const tileBeat = C.get('tileBeat');
    const cycleLen = blocks.length + C.get('sweepHold');
    const tick = Math.floor(frame / tileBeat);
    let cycle = Math.floor(tick / cycleLen);
    let pos = tick % cycleLen;
    // Settle on the final image rather than wrapping when Loop is off
    if (!C.get('loop') && n > 1 && cycle >= n - 1){ cycle = n - 2; pos = cycleLen; }

    for (const b of blocks){
      if (!covered(b)) continue;
      const laid = b.rank < pos;
      // The sheet always starts FULL: at cycle 0 every tile already carries
      // image 0 and the sweep lays image 1 over it. A tile is never blank.
      const shownCycle = laid ? cycle + 1 : cycle;
      const img = ((shownCycle % n) + n) % n;
      drawnThisFrame.push([b.rank, img]);
      if (trace) drawn.push([b.rank, img]);

      const landedAt = ((laid ? cycle : cycle - 1) * cycleLen + b.rank) * tileBeat;
      const since = Math.max(frame - landedAt, 0);
      const ef = Math.min(entryFrames, tileBeat);
      const e = ef > 0 ? clamp(since / ef, 0, 1) : 1;
      const ee = easeOutCubic(e);

      let alpha = 1, sc = 1, ex = 0, ey = 0;
      if (entryKind === 'fade') alpha = ee;
      else if (entryKind === 'grow'){ alpha = ee; sc = 0.82 + 0.18 * ee; }
      else if (entryKind === 'slide'){
        alpha = Math.min(1, ee * 1.4);
        const dir = Math.floor(hash(seed, b.id, 93) * 4);
        const d = (1 - ee) * Math.max(b.w, b.h) * 0.55;
        if (dir === 0) ex = -d; else if (dir === 1) ex = d;
        else if (dir === 2) ey = -d; else ey = d;
      }
      for (const p of b.panels){
        const jx = shash(seed, p.idx * 3 + frame, 51) * posJ;
        const jy = shash(seed, p.idx * 3 + frame, 52) * posJ;
        const jr = shash(seed, p.idx * 5 + frame, 56) * rotJ;
        drawBlockPanel(grid, b, p, img, alpha, sc,
          p.offX * pOff + ex + jx, p.offY * pOff + ey + jy, cw, ch, jr);
      }
    }
  } else {
  for (const b of blocks){
    const st = segments[b.id];
    if (!st) continue;
    if (!covered(b)) continue;

    const revealAt = (runMode === 'shuffle')
      ? 0 : revealFrameFor(b, cols, rows, blocks.length, fps, seed);
    if (frame < revealAt) continue;

    const since = Math.max(frame - Math.max(revealAt, st.entryAt), 0);
    const e = entryFrames > 0 ? clamp(since / entryFrames, 0, 1) : 1;
    const ee = easeOutCubic(e);

    let alpha = 1, sc = 1, ex = 0, ey = 0;
    if (entryKind === 'fade') alpha = ee;
    else if (entryKind === 'grow'){ alpha = ee; sc = 0.82 + 0.18 * ee; }
    else if (entryKind === 'slide'){
      alpha = Math.min(1, ee * 1.4);
      const dir = Math.floor(hash(seed, b.id, 93) * 4);
      const d = (1 - ee) * Math.max(b.w, b.h) * 0.55;
      if (dir === 0) ex = -d; else if (dir === 1) ex = d;
      else if (dir === 2) ey = -d; else ey = d;
    }

    drawnThisFrame.push([b.rank, st.cur]);
    if (trace) drawn.push([b.rank, st.cur]);
    for (const p of b.panels){
      const jx = shash(seed, p.idx * 3 + frame, 51) * posJ;
      const jy = shash(seed, p.idx * 3 + frame, 52) * posJ;
      const jr = shash(seed, p.idx * 5 + frame, 56) * rotJ;
      drawBlockPanel(grid, b, p, st.cur, alpha, sc,
        p.offX * pOff + ex + jx, p.offY * pOff + ey + jy, cw, ch, jr);
    }
  }
  }

  // press the print into the sheet
  let layer = printBuf;
  const distort = C.get('paperDistortion');
  if (sampler && paper && distort > 0.001)
    layer = P.reliefWarp(layer, sampler, paper.img, distort, C.get('paperScale'), cw, ch);
  const uneven = C.get('unevenness');
  if (uneven > 0.001)
    layer = IMP.applyPrintWear(layer, { unevenness: uneven, seed }, cw, ch);

  // ---- composite -----------------------------------------------------------
  ctx.clearRect(0, 0, cw, ch);
  const sh = IMP.shakeFor(seed, frame, C.get('cameraShake'));
  ctx.save();
  ctx.translate(cw/2 + sh.x, ch/2 + sh.y);
  ctx.rotate(sh.r);
  ctx.translate(-cw/2, -ch/2);

  const collage = collageMode();

  ctx.fillStyle = '#EDE9E0';
  ctx.fillRect(0, 0, cw, ch);
  if (paper) P.drawSheet(ctx, paper.img, C.get('paperScale'), cw, ch);

  // Whole-image mode presses the print into the sheet. Collage mode normally
  // leaves the paper bare under the cut-out subject — but with Image Background
  // on, the full printed image stays as the backdrop and the (larger) cut-out
  // sits over it, covering its own original so the subject reads as one figure
  // lifting off its own scene.
  if (!collage || C.get('imageBg')){
    ctx.save();
    ctx.globalCompositeOperation = C.get('printBlend');
    ctx.globalAlpha = C.get('printOpacity');
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  if (sampler && paper)
    P.paintPaperLight(ctx, sampler, paper.img,
      { lighting: C.get('paperLighting'), contrast: C.get('lightingContrast'),
        paperScale: C.get('paperScale') }, cw, ch);

  if (collage) drawCollage(ctx, cw, ch, seed);

  // No fold grid in this clone — the image fills the sheet, so there are no
  // creases, tone steps or panel lift to bake in.

  ctx.restore();

  IMP.paintGrainAndVignette(ctx, {
    grain: C.get('filmGrain'), vignette: C.get('vignette'), frame }, cw, ch);

  if (C.get('debugTiles')){
    const shown = new Map(drawnThisFrame);
    ctx.save();
    ctx.font = `${Math.round(Math.min(cw, ch) / 26)}px ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const b of blocks){
      const img = shown.has(b.rank) ? shown.get(b.rank) : '-';
      const t = `${b.rank + 1}\u2009\u2192\u2009${img}`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.strokeText(t, b.cx, b.cy);
      ctx.fillStyle = '#B4746E';
      ctx.fillText(t, b.cx, b.cy);
    }
    ctx.restore();
  }

  status();
}

function tick(ts){
  const fps = C.get('fps');
  if (!lastTs) lastTs = ts;
  const dt = ts - lastTs; lastTs = ts;
  if (playing){
    accum += dt;
    const step = 1000 / fps;
    let guard = 0;
    while (accum >= step && guard++ < 8){ accum -= step; advance(); dirty = true; }
    if (guard >= 8) accum = 0;          // tab was backgrounded — don't catch up
  }
  if (dirty){ dirty = false; render(); }
  requestAnimationFrame(tick);
}

const statusEl = document.getElementById('statusLine');
function status(){
  let extra = '';
  if (C.get('mode') === 'sweep' && blocks.length && activePhotos().length){
    const cycleLen = blocks.length + C.get('sweepHold');
    const tick = Math.floor(frame / C.get('tileBeat'));
    const pos = Math.min(blocks.length, tick % cycleLen);
    extra = ` · tile ${pos}/${blocks.length}`;
  }
  statusEl.textContent =
    `${grid ? grid.panels.length : 0} segments · ${activePhotos().length} images · ` +
    `f${frame} @${C.get('fps')}fps${extra} · b${BUILD}`;
}

// ── sizing ───────────────────────────────────────────────────────────────────
const sizeW = document.getElementById('sizeW');
const sizeH = document.getElementById('sizeH');
const sizePreset = document.getElementById('sizePreset');
function applySize(){
  const w = clamp(parseInt(sizeW.value) || 1080, 120, 4000);
  const h = clamp(parseInt(sizeH.value) || 1920, 120, 4000);
  C.setExtra('size', { w, h, preset: sizePreset.value });
  canvas.width = w; canvas.height = h;
  fitCanvas();
  gridKey = '';
  dirty = true;
}
function fitCanvas(){
  const stage = document.getElementById('stage');
  const pad = document.body.classList.contains('view-only') ? 0 : 88;
  const aw = stage.clientWidth - pad, ah = stage.clientHeight - pad;
  // Never let a zero-size measurement stick: a hidden or not-yet-laid-out stage
  // would pin the canvas at 0px and it would stay there even once real space
  // appeared, because nothing recomputes it.
  if (aw <= 0 || ah <= 0) return;
  const s = Math.min(aw / canvas.width, ah / canvas.height,
                     document.body.classList.contains('view-only') ? 4 : 1.2);
  canvas.style.width = Math.round(canvas.width * s) + 'px';
  canvas.style.height = Math.round(canvas.height * s) + 'px';
}
sizeW.addEventListener('change', () => { sizePreset.value = 'custom'; applySize(); });
sizeH.addEventListener('change', () => { sizePreset.value = 'custom'; applySize(); });
sizePreset.addEventListener('change', () => {
  if (sizePreset.value === 'custom') return;
  const [w, h] = sizePreset.value.split('x');
  sizeW.value = w; sizeH.value = h; applySize();
});
window.addEventListener('resize', fitCanvas);
if (window.ResizeObserver)
  new ResizeObserver(() => fitCanvas()).observe(document.getElementById('stage'));

// ── actions ──────────────────────────────────────────────────────────────────
const toastEl = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
const toastUndo = document.getElementById('toastUndo');
let undoFn = null;
const toast = (msg, undo) => {
  toastMsg.textContent = msg;
  undoFn = undo || null;
  toastUndo.hidden = !undoFn;
  toastEl.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.classList.remove('on'); undoFn = null; },
                        undoFn ? 6000 : 2200);
};
toastUndo.addEventListener('click', () => {
  if (!undoFn) return;
  const fn = undoFn; undoFn = null;
  toastEl.classList.remove('on');
  fn();
  toast('Restored');
});

C.onReset((label, before) => {
  gridKey = ''; dirty = true;
  toast(label + ' reset', () => { C.restore(before); gridKey = ''; dirty = true; });
});

const resetEverything = () => {
  const before = C.snapshot();
  C.resetAll();
  gridKey = ''; resetTimeline();
  toast('All controls reset', () => { C.restore(before); gridKey = ''; dirty = true; });
};

const SWEEP_LOCK = 'Locked in Sequential — a tile-by-tile reveal needs one image per cell';
const SEQ_UNUSED = 'Not used in Sequential — pacing comes from Tile Beat and Sweep Hold';
function syncModeLocks(){
  const sweep = C.get('mode') === 'sweep';
  C.setLocked('grouping', sweep, 0, SWEEP_LOCK);
  C.setLocked('groupCap', sweep, 1, SWEEP_LOCK);
  C.setLocked('coverage', sweep, 1, SWEEP_LOCK);
  C.setLocked('revealOrder', sweep, 'reading', SWEEP_LOCK);
  C.setLocked('shuffleMode', sweep, 'sequential', SEQ_UNUSED);
  C.setLocked('holdFrames', sweep, 1, SEQ_UNUSED);
  C.setLocked('holdJitter', sweep, 0, SEQ_UNUSED);
  C.setLocked('swapChance', sweep, 1, SEQ_UNUSED);
  C.setLocked('revealDuration', sweep, 0.1, SEQ_UNUSED);
  C.setLocked('revealStagger', sweep, 0, SEQ_UNUSED);
  gridKey = ''; dirty = true;
}
C.onChange('mode', syncModeLocks);
syncModeLocks();

C.onChange('reroll', () => C.set('seed', 1 + Math.floor(Math.random() * 9998)));
C.onChange('resetAll2', resetEverything);
C.onChange('cutoutAll', cutoutAll);
// Turning cutout on for the first time processes whatever's already loaded.
C.onChange('cutout', (on) => { if (on) cutoutAll(); dirty = true; });
document.getElementById('resetAll').addEventListener('click', resetEverything);
['seed','cols','rows','revealOrder','revealStagger','revealDuration','mode','entry']
  .forEach(k => C.onChange(k, resetTimeline));

document.getElementById('btnReplay').addEventListener('click', () => { resetTimeline(); playing = true; syncPlay(); });
const btnPlay = document.getElementById('btnPlay');
function syncPlay(){ btnPlay.textContent = playing ? 'Pause' : 'Play'; }
btnPlay.addEventListener('click', () => { playing = !playing; syncPlay(); });
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space'){ e.preventDefault(); playing = !playing; syncPlay(); }
  if (e.key === 'r') { resetTimeline(); }
});

// ── sessions ────────────────────────────────────────────────────────────────
// A published session owns its URL forever. Opening one puts the app in session
// mode: edits are live but transient until Save writes them back to the same id.
let session = null;            // { id, key, sig }
const docNow = () => ({
  settings: C.all(),
  size: { w: canvas.width, h: canvas.height, preset: sizePreset.value },
  photos
});
const isDirty = () => !!session && SESSION.signature(docNow()) !== session.sig;

function markClean(){
  if (session) session.sig = SESSION.signature(docNow());
  syncSaveBtn();
}
// The footer's primary action must never read "Share" when Save is what's
// wanted. Three states: no session, a session we can write to, and a session we
// can only read (an editable link opened without its key, or one published
// before edit keys existed) — where the honest action is to fork a copy.
// In a session, the id IS the document's name — show it instead of the app name.
function syncTitle(){
  const h = document.querySelector('.panel-title h1');
  if (h) h.textContent = session ? session.id : 'Paper Stop-Motion';
  document.title = session ? `${session.id} \u00b7 Paper Stop-Motion`
                           : 'Paper Stop-Motion';
}

function syncSaveBtn(){
  syncTitle();
  const save = document.getElementById('btnSave');
  const share = document.getElementById('btnShare');
  if (!save || !share) return;
  const owned = !!session && !!session.key;
  const dirty = isDirty();

  save.hidden = !owned;
  share.hidden = false;

  if (owned){
    save.textContent = dirty ? 'Save *' : 'Saved';
    save.classList.toggle('dirty', dirty);
    save.disabled = !dirty;
    share.textContent = 'Links';
    share.title = 'Show this session\u2019s links';
  } else if (session){
    share.textContent = 'Save a copy';
    share.title = 'This link can\u2019t overwrite its session \u2014 publish a new one';
  } else {
    share.textContent = 'Share';
    share.removeAttribute('title');
  }
  document.body.classList.toggle('unsaved', dirty);
}
C.onAny(() => syncSaveBtn());

// Leaving with unsaved edits throws them away, so say so.
window.addEventListener('beforeunload', (e) => {
  if (!isDirty()) return;
  e.preventDefault();
  e.returnValue = '';
});
const shareModal = document.getElementById('shareModal');
const shareBody = document.getElementById('shareBody');
const closeShare = () => shareModal.classList.remove('on');
document.getElementById('shareClose').addEventListener('click', closeShare);
shareModal.addEventListener('click', (e) => { if (e.target === shareModal) closeShare(); });

function urlRow(label, url, note){
  const id = 'u' + Math.random().toString(36).slice(2, 8);
  return `<div class="url-row">
      <div class="url-label">${label}<span>${note}</span></div>
      <div class="url-box"><input readonly value="${url}" id="${id}">
        <button data-copy="${id}">Copy</button></div>
    </div>`;
}

document.getElementById('btnSave').addEventListener('click', async () => {
  if (!session || !session.key) return;
  const btn = document.getElementById('btnSave');
  btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    await SESSION.save(session.id, session.key, SESSION.serialize(docNow()));
    C.setBaseline(C.all());          // Reset now returns to what was just saved
    markClean();
    toast('Session saved');
  } catch (err){
    toast(err.message);
    syncSaveBtn();
  }
});

function showLinks(id, key, extraNote){
  const base = SESSION.appBase();
  shareBody.innerHTML =
    urlRow('Editable', `${base}?s=${id}${key ? '&k=' + key : ''}`,
           key ? 'dials open \u00b7 Save writes back here' : 'dials open \u00b7 cannot overwrite') +
    urlRow('Play only', `${base}?v=${id}`, 'no panel, just the animation') +
    `<p class="share-note">${extraNote}</p>`;
  shareBody.querySelectorAll('[data-copy]').forEach(b =>
    b.addEventListener('click', () => {
      const inp = document.getElementById(b.dataset.copy);
      inp.select();
      navigator.clipboard.writeText(inp.value).then(() => {
        b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1600);
      });
    }));
}

document.getElementById('btnShare').addEventListener('click', async () => {
  // an owned session already has its links — don't mint a second one
  if (session && session.key){
    showLinks(session.id, session.key,
      'These URLs are permanent. Save updates this session in place. The editable ' +
      'link carries its edit key, so anyone you send it to can overwrite it; the ' +
      'play-only link cannot.');
    shareModal.classList.add('on');
    return;
  }
  shareBody.innerHTML = `<p class="share-note">Packing session\u2026</p>`;
  shareModal.classList.add('on');
  try {
    const payload = SESSION.serialize({
      settings: C.all(),
      size: { w: canvas.width, h: canvas.height, preset: sizePreset.value },
      photos
    });
    const { id, key } = await SESSION.publish(payload);
    session = { id, key, sig: SESSION.signature(docNow()) };
    C.setBaseline(C.all());
    C.setPersist(false);
    // point the address bar at what was just published, so a reload reopens it
    history.replaceState(null, '', `${location.pathname}?s=${id}&k=${key}`);
    syncSaveBtn();
    showLinks(id, key,
      'These URLs are permanent \u2014 Save updates this session in place rather ' +
      'than making a new one. The editable link carries its edit key, so anyone ' +
      'you send it to can overwrite it; the play-only link cannot.');
  } catch (err){
    shareBody.innerHTML = `<p class="share-note err">${err.message}</p>`;
  }
});

async function applySession(sess, mode, route){
  // set the layout mode first — fitCanvas measures the stage, which is a
  // different size once the panel is gone
  if (mode === 'view') document.body.classList.add('view-only');
  if (sess.size && Number.isFinite(sess.size.w)){
    sizeW.value = sess.size.w; sizeH.value = sess.size.h;
    if (sess.size.preset) sizePreset.value = sess.size.preset;
    applySize();
  }
  photos = [];
  for (const e of (sess.images || [])){
    const src = (e.d !== undefined && DEMO[e.d]) ? DEMO[e.d] : e.u;
    if (!src) continue;
    try {
      const img = await P.loadImage(src);
      photos.push({ src, img, on: e.on !== false, demo: e.d !== undefined, demoIndex: e.d });
    } catch { /* skip */ }
  }
  C.setExtra('demoDismissed', true);
  for (const k in (sess.settings || {})) C.set(k, sess.settings[k]);
  // Reset now returns to the session, not to the app defaults
  C.setBaseline(sess.settings || {});
  refreshStrips();
  gridKey = ''; resetTimeline();
  fitCanvas();
  // edits from here are transient until Save
  C.setPersist(false);
  session = { id: route.id, key: route.key || '', sig: '' };
  markClean();
}

// ── PNG export: every frame of one full loop, numbered, in a single .zip ───────
// Many separate downloads trip the browser's multi-file blocker, so the frames
// are packed into one store-only zip (PNGs are already compressed) and handed
// over as a single file.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf){
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files){
  const enc = new TextEncoder();
  const u16 = n => new Uint8Array([n & 255, (n >> 8) & 255]);
  const u32 = n => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
  const cat = (...a) => { const o = []; for (const x of a) o.push(...x); return new Uint8Array(o); };
  const parts = [], central = [];
  let offset = 0;
  for (const f of files){
    const name = enc.encode(f.name);
    const crc = crc32(f.data), size = f.data.length;
    const local = cat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(name.length), u16(0), name);
    parts.push(local, f.data);
    central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name));
    offset += local.length + size;
  }
  let cdSize = 0;
  for (const c of central){ parts.push(c); cdSize += c.length; }
  parts.push(cat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cdSize), u32(offset), u16(0)));
  return new Blob(parts, { type: 'application/zip' });
}

let exporting = false;

// PNGs: one full loop rendered offline, deduped, packed into a numbered zip.
async function exportPngs(){
  if (exporting) return;
  if (!blocks.length || !activePhotos().length){ toast('Nothing to export yet'); return; }
  const btn = document.getElementById('btnExport');
  const label = btn.textContent;
  exporting = true; btn.disabled = true;
  const seed = C.get('seed');
  const snap = { playing, frame, accum, paperIndex, segments };
  playing = false;
  try {
    const total = Math.max(1, Math.round(loopLength()));
    frame = 0; accum = 0; paperIndex = 0; segments = [];
    const kept = [];
    const seen = new Set();
    for (let i = 0; i < total; i++){
      if (i > 0) advance();
      dirty = false; render();
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const data = new Uint8Array(await blob.arrayBuffer());
      const key = crc32(data) + ':' + data.length;
      if (!seen.has(key)){ seen.add(key); kept.push(data); }
      btn.textContent = `${i + 1}/${total}`;
      if ((i & 3) === 0) await new Promise(r => setTimeout(r));
    }
    const pad = String(kept.length).length;
    const files = kept.map((data, i) => ({
      name: `frame_${String(i).padStart(pad, '0')}.png`, data }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zipStore(files));
    a.download = `paper-shuffle-${seed}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    toast(`${kept.length} frames saved`);
  } catch (err){
    console.error(err);
    toast('Export failed');
  } finally {
    playing = snap.playing; frame = snap.frame; accum = snap.accum;
    paperIndex = snap.paperIndex; segments = snap.segments;
    btn.textContent = label; btn.disabled = false; exporting = false;
    dirty = true;
  }
}

// MP4 via WebCodecs (H.264) + mp4-muxer. Rendered OFFLINE frame-by-frame — the
// same deterministic loop as the PNG export — then encoded and muxed into a
// clean, seekable MP4. This avoids MediaRecorder's real-time capture of a
// beat-driven canvas and its fragmented-MP4 output, which many players couldn't
// open. The muxer is fetched from a CDN on first use, like the cutout model.
let mp4muxerMod = null;
const loadMp4Muxer = async () =>
  (mp4muxerMod ||= await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm'));

async function exportMp4(){
  if (exporting) return;
  if (!blocks.length || !activePhotos().length){ toast('Nothing to export yet'); return; }
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined'){
    toast('MP4 not supported in this browser'); return;
  }
  const btn = document.getElementById('btnExport');
  const label = btn.textContent;
  const seed = C.get('seed');
  const fps = C.get('fps');
  exporting = true; btn.disabled = true; btn.textContent = 'MP4…';
  const snap = { playing, frame, accum, paperIndex, segments };
  playing = false;
  try {
    const { Muxer, ArrayBufferTarget } = await loadMp4Muxer();

    // Pick an H.264 level that actually supports the frame size — a large pasted
    // image can exceed the lower levels. Downscale only if even the top level
    // can't take it. (A fixed low level was the cause of "MP4 export failed".)
    const bitrate = 12_000_000;
    const levels = ['avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.640028', 'avc1.4d0028'];
    const pick = async (w, h) => {
      for (const codec of levels){
        try {
          const s = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps });
          if (s.supported) return codec;
        } catch { /* try next level */ }
      }
      return null;
    };
    let W = canvas.width & ~1, H = canvas.height & ~1;         // H.264 needs even dims
    let codec = await pick(W, H);
    while (!codec && W > 320){
      W = Math.round(W / 2) & ~1; H = Math.round(H / 2) & ~1;
      codec = await pick(W, H);
    }
    if (!codec) throw new Error('MP4 not supported at this size');

    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
    const tctx = tmp.getContext('2d');
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H },
      fastStart: 'in-memory',
    });
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error('VideoEncoder', e),
    });
    encoder.configure({ codec, width: W, height: H, bitrate, framerate: fps });

    const total = Math.max(1, Math.round(loopLength()));
    frame = 0; accum = 0; paperIndex = 0; segments = [];
    const durUs = Math.round(1e6 / fps);
    for (let i = 0; i < total; i++){
      if (i > 0) advance();
      dirty = false; render();
      tctx.drawImage(canvas, 0, 0, W, H);
      const vf = new VideoFrame(tmp, { timestamp: i * durUs, duration: durUs });
      encoder.encode(vf, { keyFrame: i % 30 === 0 });
      vf.close();
      btn.textContent = `${i + 1}/${total}`;
      if (encoder.encodeQueueSize > 6) await new Promise(r => setTimeout(r));
    }
    await encoder.flush();
    muxer.finalize();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([muxer.target.buffer], { type: 'video/mp4' }));
    a.download = `paper-shuffle-${seed}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    toast('MP4 saved');
  } catch (err){
    console.error(err);
    toast('MP4 export failed');
  } finally {
    playing = snap.playing; frame = snap.frame; accum = snap.accum;
    paperIndex = snap.paperIndex; segments = snap.segments;
    btn.textContent = label; btn.disabled = false; exporting = false; dirty = true;
  }
}

// Looping GIF via gifenc — the full loop rendered offline at a capped size, with
// identical consecutive frames collapsed into a single frame + longer delay so
// the file stays small. gifenc writes an infinite-loop extension by default.
let gifencMod = null;
const loadGifenc = async () =>
  (gifencMod ||= await import('https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js'));

async function exportGif(){
  if (exporting) return;
  if (!blocks.length || !activePhotos().length){ toast('Nothing to export yet'); return; }
  const btn = document.getElementById('btnExport');
  const label = btn.textContent;
  exporting = true; btn.disabled = true;
  const seed = C.get('seed');
  const snap = { playing, frame, accum, paperIndex, segments };
  playing = false;
  try {
    btn.textContent = 'GIF…';
    const { GIFEncoder, quantize, applyPalette } = await loadGifenc();
    const scale = Math.min(1, 640 / Math.max(canvas.width, canvas.height));
    const gw = Math.max(1, Math.round(canvas.width * scale));
    const gh = Math.max(1, Math.round(canvas.height * scale));
    const gcv = document.createElement('canvas');
    gcv.width = gw; gcv.height = gh;
    const gcx = gcv.getContext('2d', { willReadFrequently: true });
    const gif = GIFEncoder();
    const baseDelay = Math.max(20, Math.round(1000 / C.get('fps')));
    const total = Math.max(1, Math.round(loopLength()));
    frame = 0; accum = 0; paperIndex = 0; segments = [];
    let prevKey = null, prevData = null, run = 0, written = 0;
    const flush = () => {
      if (!prevData) return;
      const palette = quantize(prevData, 256, { format: 'rgb565' });
      const index = applyPalette(prevData, palette, 'rgb565');
      gif.writeFrame(index, gw, gh, { palette, delay: run * baseDelay, repeat: 0 });
      written++;
    };
    for (let i = 0; i < total; i++){
      if (i > 0) advance();
      dirty = false; render();
      gcx.clearRect(0, 0, gw, gh);
      gcx.drawImage(canvas, 0, 0, gw, gh);
      const data = gcx.getImageData(0, 0, gw, gh).data;
      const key = crc32(data) + ':' + data.length;
      if (key === prevKey) run++;
      else { flush(); prevData = data; prevKey = key; run = 1; }
      btn.textContent = `${i + 1}/${total}`;
      if ((i & 3) === 0) await new Promise(r => setTimeout(r));
    }
    flush();
    gif.finish();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([gif.bytes()], { type: 'image/gif' }));
    a.download = `paper-shuffle-${seed}.gif`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    toast(`GIF saved · ${written} frames`);
  } catch (err){
    console.error(err);
    toast('GIF export failed');
  } finally {
    playing = snap.playing; frame = snap.frame; accum = snap.accum;
    paperIndex = snap.paperIndex; segments = snap.segments;
    btn.textContent = label; btn.disabled = false; exporting = false; dirty = true;
  }
}

// Export button opens a small menu: PNGs, MP4 or GIF.
const btnExportEl = document.getElementById('btnExport');
const foot = btnExportEl.closest('.panel-foot') || btnExportEl.parentElement;
foot.style.position = 'relative';
const exportMenu = document.createElement('div');
exportMenu.style.cssText = 'position:absolute; bottom:calc(100% + 8px); display:none;' +
  'flex-direction:column; min-width:120px; background:#fff; border:1px solid rgba(0,0,0,.06);' +
  'border-radius:12px; box-shadow:0 14px 34px rgba(0,0,0,.18); padding:6px; z-index:60;';
exportMenu.innerHTML =
  '<button data-x="png" style="all:unset;cursor:pointer;padding:8px 12px;border-radius:8px;font:inherit">PNGs</button>' +
  '<button data-x="mp4" style="all:unset;cursor:pointer;padding:8px 12px;border-radius:8px;font:inherit">MP4</button>' +
  '<button data-x="gif" style="all:unset;cursor:pointer;padding:8px 12px;border-radius:8px;font:inherit">GIF</button>';
foot.appendChild(exportMenu);
const closeExportMenu = () => { exportMenu.style.display = 'none'; };
btnExportEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (exporting) return;
  exportMenu.style.left = btnExportEl.offsetLeft + 'px';
  exportMenu.style.display = exportMenu.style.display === 'flex' ? 'none' : 'flex';
});
exportMenu.addEventListener('click', (e) => {
  const x = e.target && e.target.dataset && e.target.dataset.x;
  if (!x) return;
  closeExportMenu();
  if (x === 'png') exportPngs(); else if (x === 'mp4') exportMp4(); else exportGif();
});
exportMenu.addEventListener('mouseover', (e) => {
  if (e.target.dataset && e.target.dataset.x) e.target.style.background = 'rgba(0,0,0,.05)';
});
exportMenu.addEventListener('mouseout', (e) => {
  if (e.target.dataset && e.target.dataset.x) e.target.style.background = 'transparent';
});
document.addEventListener('click', closeExportMenu);

const filePick = document.createElement('input');
filePick.type = 'file'; filePick.accept = 'image/*'; filePick.multiple = true;
filePick.addEventListener('change', () => {
  addUserPhotos([...filePick.files]);
  filePick.value = '';
});
C.onChange('addPhotos', () => filePick.click());

// Explicit escape hatch: bring the placeholders back and let them persist again.
C.onChange('resetPhotos', async () => {
  const before = photos.slice();
  photos = []; refreshStrips();
  await addSources(photos, DEMO, true);
  C.setExtra('demoDismissed', false);
  resetTimeline();
  toast('Demo set loaded', () => {
    photos = before; C.setExtra('demoDismissed', !before.some(p => p.demo));
    refreshStrips(); resetTimeline();
  });
});

C.onChange('clearPhotos', () => {
  if (!photos.length) return toast('Nothing to clear');
  const before = photos.slice();
  const n = before.length;
  photos = [];
  C.setExtra('demoDismissed', true);
  refreshStrips(); resetTimeline();
  toast(`${n} image${n === 1 ? '' : 's'} cleared`, () => {
    photos = before;
    C.setExtra('demoDismissed', !before.some(p => p.demo));
    refreshStrips(); resetTimeline();
  });
});

const veil = document.getElementById('dropVeil');
let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); if (++dragDepth === 1) veil.classList.add('on'); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('dragleave', e => { if (--dragDepth <= 0){ dragDepth = 0; veil.classList.remove('on'); } });
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; veil.classList.remove('on');
  const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  await addUserPhotos(files);
});

// Cmd/Ctrl+V pastes an image straight in (and the sheet resizes to match it).
window.addEventListener('paste', async e => {
  const items = [...(e.clipboardData?.items || [])];
  const files = items.filter(it => it.type.startsWith('image/'))
                     .map(it => it.getAsFile()).filter(Boolean);
  if (!files.length) return;                 // no image on the clipboard — let paste be
  e.preventDefault();
  await addUserPhotos(files);
});

// Debug handle — the preview pane backgrounds the page, which freezes rAF, so
// verification needs to drive frames by hand.
window.__ps = {
  render, canvas, C,
  step(n = 1){ for (let i = 0; i < n; i++){ advance(); render(); } },
  goto(f){ resetTimeline(); this.step(f); },
  info(){ return { frame, panels: grid ? grid.panels.length : 0,
                   photos: activePhotos().length, papers: activePapers().length,
                   playing }; },
  pause(){ playing = false; },
  setTrace(v){ trace = !!v; },
  drawn(){ return drawn.slice().sort((a, b) => a[0] - b[0]); },
  blocks(){ return blocks.map(b => ({ id: b.id, rank: b.rank, i: b.i, j: b.j })); }
};

// ── boot ─────────────────────────────────────────────────────────────────────
(async function boot(){
  const size = C.getExtra('size');
  if (size && Number.isFinite(size.w) && Number.isFinite(size.h)){
    sizeW.value = clamp(size.w, 120, 4000);
    sizeH.value = clamp(size.h, 120, 4000);
    if (size.preset) sizePreset.value = size.preset;
  }
  applySize();
  syncPlay();
  requestAnimationFrame(tick);
  const route = SESSION.routeOf();
  await addSources(papers, PAPERS, false);
  if (route){
    try {
      await applySession(await SESSION.load(route.id), route.mode, route);
    } catch (err){
      toast(err.message);
      await addSources(photos, DEMO, true);
    }
  } else if (!C.getExtra('demoDismissed')){
    await addSources(photos, DEMO, true);
  }
  resetTimeline();
  fitCanvas();
})();
