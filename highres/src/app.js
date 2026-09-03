import * as C from './controls.js';
import { hash, shash, clamp, easeOutCubic, easeInOutCubic, mulberry32 } from './rng.js';
import * as P from './paper.js';
import * as F from './folds.js';
import * as IMP from './imperfections.js';
import * as SESSION from './session.js';

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
  { type:'slider', key:'coverage', label:'Coverage', min:0, max:1, step:0.01, default:1 },

  { type:'section', label:'Segments', collapsed:false },
  { type:'number', key:'cols', label:'Columns', min:1, max:12, step:1, default:3 },
  { type:'number', key:'rows', label:'Rows', min:1, max:12, step:1, default:4 },
  { type:'slider', key:'gridJitter', label:'Grid Jitter', min:0, max:1, step:0.01, default:0.18 },
  { type:'slider', key:'foldWaver', label:'Fold Waver', min:0, max:12, step:0.1, default:2.2, unit:'px' },
  { type:'slider', key:'foldSkew', label:'Fold Skew', min:0, max:20, step:0.5, default:4, unit:'px' },
  { type:'slider', key:'tear', label:'Edge Tear', min:0, max:6, step:0.1, default:0.6, unit:'px' },
  { type:'slider', key:'panelOffset', label:'Panel Offset', min:0, max:24, step:0.5, default:7, unit:'px' },
  { type:'slider', key:'panelRotate', label:'Panel Rotate', min:0, max:2.5, step:0.05, default:0.25, unit:'°' },
  { type:'slider', key:'grouping', label:'Grouping', min:0, max:1, step:0.02, default:0.35 },
  { type:'number', key:'groupCap', label:'Max Block', min:1, max:12, step:1, default:4 },

  { type:'section', label:'Fold & Depth', collapsed:false },
  { type:'slider', key:'panelTone', label:'Panel Tone', min:0, max:1, step:0.01, default:0.5 },
  { type:'slider', key:'creaseHighlight', label:'Ridge Light', min:0, max:2, step:0.02, default:1.1 },
  { type:'slider', key:'creaseShadow', label:'Ridge Shadow', min:0, max:2, step:0.02, default:0.10 },
  { type:'slider', key:'creaseWidth', label:'Ridge Width', min:0.3, max:8, step:0.1, default:1.6, unit:'px' },
  { type:'slider', key:'creaseSoft', label:'Ridge Softness', min:0, max:2, step:0.02, default:0.32 },
  { type:'slider', key:'creaseVary', label:'Ridge Variance', min:0, max:1, step:0.02, default:0.5 },
  { type:'slider', key:'panelLift', label:'Panel Lift', min:0, max:2, step:0.02, default:1.3 },
  { type:'slider', key:'lightAngle', label:'Light Angle', min:0, max:360, step:1, default:305, unit:'°' },

  { type:'section', label:'Paper & Environment', collapsed:true },
  { type:'custom', render:() => paperStrip },
  { type:'segmented', key:'paperSwapMode', label:'Swap', default:'random', options:[
      {id:'sequential',label:'Sequential'},{id:'random',label:'Random'},{id:'hold',label:'Hold'}] },
  { type:'slider', key:'paperScale', label:'Paper Scale', min:0.5, max:3, step:0.05, default:1.15 },
  { type:'slider', key:'paperDistortion', label:'Paper Distortion', min:0, max:3, step:0.05, default:0.9 },
  { type:'slider', key:'paperLighting', label:'Paper Lighting', min:0, max:2, step:0.05, default:0.85 },
  { type:'slider', key:'lightingContrast', label:'Lighting Contrast', min:0, max:2, step:0.05, default:1 },

  { type:'section', label:'Animation & Stop-Motion', collapsed:false },
  { type:'slider', key:'fps', label:'FPS', min:1, max:30, step:1, default:6 },
  { type:'slider', key:'tileBeat', label:'Tile Beat', min:1, max:12, step:1, default:1, unit:'f' },
  { type:'slider', key:'sweepHold', label:'Sweep Hold', min:0, max:40, step:1, default:6, unit:'f' },
  { type:'slider', key:'revealDuration', label:'Reveal', min:0.1, max:10, step:0.1, default:1.8, unit:'s' },
  { type:'slider', key:'revealStagger', label:'Stagger', min:0, max:1, step:0.05, default:0.7 },
  { type:'select', key:'revealOrder', label:'Order', default:'reading', options:[
      {id:'reading',label:'Reading'},{id:'scattered',label:'Scattered'},
      {id:'centre',label:'Centre Out'},{id:'columns',label:'Columns'}] },
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
  { type:'toggle', key:'debugTiles', label:'Tile numbers', default:false },
  { type:'buttons', buttons:[{key:'reroll',label:'Reroll seed'},{key:'resetAll2',label:'Reset all',danger:true}] }
];

C.build(schema, document.getElementById('controls'));
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
async function addUserPhotos(srcs){
  const hadDemo = photos.some(p => p.demo);
  if (hadDemo) photos = photos.filter(p => !p.demo);
  const n = await addSources(photos, srcs, false);
  C.setExtra('demoDismissed', true);
  resetTimeline();
  if (!n) toast('Could not read those files');
  else toast(hadDemo ? `${n} added · placeholders cleared` : `${n} added`);
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
  const ap = activePapers();
  const mode = C.get('paperSwapMode');
  if (ap.length > 1 && mode !== 'hold'){
    if (mode === 'random'){
      let next = Math.floor(mulberry32((seed + frame * 131) >>> 0)() * ap.length);
      if (next === paperIndex) next = (next + 1) % ap.length;
      paperIndex = next;
    } else paperIndex = frame % ap.length;
  } else if (ap.length <= 1) paperIndex = 0;

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
  const img = list[clamp(entry, 0, list.length - 1)].img;
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
  const paper = ap.length ? ap[Math.min(paperIndex, ap.length - 1)] : null;
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

  ctx.fillStyle = '#EDE9E0';
  ctx.fillRect(0, 0, cw, ch);
  if (paper) P.drawSheet(ctx, paper.img, C.get('paperScale'), cw, ch);

  ctx.save();
  ctx.globalCompositeOperation = C.get('printBlend');
  ctx.globalAlpha = C.get('printOpacity');
  ctx.drawImage(layer, 0, 0);
  ctx.restore();

  if (sampler && paper)
    P.paintPaperLight(ctx, sampler, paper.img,
      { lighting: C.get('paperLighting'), contrast: C.get('lightingContrast'),
        paperScale: C.get('paperScale') }, cw, ch);

  // Tone, lift and creases don't change between stop-motion beats — they're
  // baked once into three layers and blitted.
  F.paintFoldLayers(ctx, F.buildFoldLayers(grid, {
    tone: C.get('panelTone'), highlight: C.get('creaseHighlight'),
    shadow: C.get('creaseShadow'), width: C.get('creaseWidth'),
    softness: C.get('creaseSoft'), variance: C.get('creaseVary'),
    lift: C.get('panelLift'), lightAngle }));

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
  if (h) h.textContent = session ? session.id : 'Paper Hi-Res';
  document.title = session ? `${session.id} \u00b7 Paper Hi-Res`
                           : 'Paper Hi-Res';
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
document.getElementById('btnExport').addEventListener('click', async () => {
  if (exporting) return;
  if (!blocks.length || !activePhotos().length){ toast('Nothing to export yet'); return; }
  const btn = document.getElementById('btnExport');
  const label = btn.textContent;
  exporting = true; btn.disabled = true;
  const seed = C.get('seed');
  // Rewind to a clean start, then step frame-by-frame off the render loop.
  const snap = { playing, frame, accum, paperIndex, segments };
  playing = false;
  try {
    const total = Math.max(1, Math.round(loopLength()));
    frame = 0; accum = 0; paperIndex = 0; segments = [];
    // A stop-motion loop holds on the same picture for many beats, so most frames
    // are byte-for-byte repeats. Keep only frames whose pixels differ from the
    // last kept one, then number the survivors consecutively.
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
      if ((i & 3) === 0) await new Promise(r => setTimeout(r));   // let the label repaint
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
    // restore the live timeline exactly where it was
    playing = snap.playing; frame = snap.frame; accum = snap.accum;
    paperIndex = snap.paperIndex; segments = snap.segments;
    btn.textContent = label; btn.disabled = false; exporting = false;
    dirty = true;
  }
});

const filePick = document.createElement('input');
filePick.type = 'file'; filePick.accept = 'image/*'; filePick.multiple = true;
filePick.addEventListener('change', () => {
  addUserPhotos([...filePick.files].map(f => URL.createObjectURL(f)));
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
  await addUserPhotos(files.map(f => URL.createObjectURL(f)));
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
