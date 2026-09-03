// ─────────────────────────────────────────────────────────────────────────────
// Fold grid + crease depth.
//
// Three separable signals, measured off the reference clip, are what make a
// folded sheet read as physical:
//   1. panel tone step   — each panel sits at its own brightness (~±2%)
//   2. panel content offset — the print is DISCONTINUOUS across every crease
//   3. crease = bright ridge + soft shadow, varying ALONG its own length
// A crease drawn as one uniform stroke reads as CSS. The along-line variation
// is the whole trick.
// ─────────────────────────────────────────────────────────────────────────────
import { hash, shash, fbm1, clamp, lerp } from './rng.js';

const SAMPLES = 26;   // samples per fold line / panel edge

// A fold line is a gently wavering curve, not a straight rule. `waver` is the
// MAX amplitude — each line takes a random fraction of it.
function makeLine(seed, idx, salt, nominal, span, waver, skew){
  const amp = waver * hash(seed, idx, salt);
  const freq = 0.7 + hash(seed, idx, salt + 5) * 1.3;
  const phase = hash(seed, idx, salt + 9) * 10;
  const tilt = shash(seed, idx, salt + 13) * skew;
  return {
    nominal,
    // position of the line at parameter t (0..1 along its length)
    at(t){
      const n = (fbm1(seed, salt + idx * 31, phase + t * freq * 3.1) - 0.5) * 2;
      return nominal + n * amp + (t - 0.5) * tilt;
    },
    // mountain folds catch light on the near side, valleys on the far side
    mountain: hash(seed, idx, salt + 21) > 0.42,
    weight: 0.55 + hash(seed, idx, salt + 27) * 0.45,
    span
  };
}

export function buildGrid(opt){
  const { cols, rows, w, h, seed, gridJitter, foldWaver, foldSkew } = opt;
  // Geometry (line waver/skew + grid jitter) is seeded separately from panel
  // identity, so a caller can re-roll the fold shape per frame while keeping the
  // same panels/grouping. Falls back to `seed` when not supplied.
  const jseed = opt.jseed === undefined ? seed : opt.jseed;

  const vx = [], hy = [];
  for (let i = 0; i <= cols; i++){
    let nx = (i / cols) * w;
    if (i > 0 && i < cols) nx += shash(jseed, i, 41) * gridJitter * (w / cols) * 0.5;
    vx.push(nx);
  }
  for (let j = 0; j <= rows; j++){
    let ny = (j / rows) * h;
    if (j > 0 && j < rows) ny += shash(jseed, j, 43) * gridJitter * (h / rows) * 0.5;
    hy.push(ny);
  }

  // Edge lines don't waver — the sheet's outer boundary is the canvas.
  const vLines = vx.map((x, i) => (i === 0 || i === cols)
    ? { nominal: x, at: () => x, mountain: true, weight: 0, span: h }
    : makeLine(jseed, i, 101, x, h, foldWaver, foldSkew));
  const hLines = hy.map((y, j) => (j === 0 || j === rows)
    ? { nominal: y, at: () => y, mountain: true, weight: 0, span: w }
    : makeLine(jseed, j, 211, y, w, foldWaver, foldSkew));

  // corner (i,j) — one fixed-point pass is plenty, deviations are a few px
  const cornerX = [], cornerY = [];
  for (let j = 0; j <= rows; j++){
    cornerX[j] = []; cornerY[j] = [];
    for (let i = 0; i <= cols; i++){
      const y0 = hLines[j].at(vx[i] / w);
      const x1 = vLines[i].at(y0 / h);
      const y1 = hLines[j].at(x1 / w);
      cornerX[j][i] = x1; cornerY[j][i] = y1;
    }
  }

  const panels = [];
  for (let j = 0; j < rows; j++){
    for (let i = 0; i < cols; i++){
      const idx = j * cols + i;
      panels.push({
        i, j, idx,
        x0: cornerX[j][i], x1: cornerX[j][i+1],
        y0: cornerY[j][i], y1: cornerY[j+1][i],
        cx: (cornerX[j][i] + cornerX[j][i+1]) / 2,
        cy: (cornerY[j][i] + cornerY[j+1][i]) / 2,
        w: cornerX[j][i+1] - cornerX[j][i],
        h: cornerY[j+1][i] - cornerY[j][i],
        // this panel's own little plane: how far off-register its print sits
        offX: shash(seed, idx, 61),
        offY: shash(seed, idx, 62),
        rot:  shash(seed, idx, 63),
        tone: shash(seed, idx, 64),
        // mountain if either bounding fold is a mountain — drives the tone ramp
        up: (vLines[i+1].mountain ? 1 : -1) * 0.5 + (hLines[j+1].mountain ? 1 : -1) * 0.5
      });
    }
  }

  return { vLines, hLines, cornerX, cornerY, panels, cols, rows, w, h, seed, jseed };
}

// Panel outline, following the wavering folds, optionally torn.
// Returned as a cached Path2D — these get clipped/filled several times per
// frame and rebuilding 200 line segments each time is pure waste.
export function panelPath(grid, p, tear, bleed = 0.75){
  const key = tear.toFixed(2) + ':' + bleed.toFixed(2);
  if (!p._paths) p._paths = {};
  if (p._paths[key]) return p._paths[key];

  const { vLines, hLines, cornerX, cornerY, w, h, seed } = grid;
  const { i, j } = p;
  const tj = (t, salt) => tear ? (fbm1(seed, salt, t * 11) - 0.5) * 2 * tear : 0;
  const path = new Path2D();

  for (let s = 0; s <= SAMPLES; s++){                       // top
    const t = s / SAMPLES;
    const x = lerp(cornerX[j][i], cornerX[j][i+1], t);
    const y = hLines[j].at(x / w) + tj(t, 300 + j * 17 + i) - bleed;
    s ? path.lineTo(x, y) : path.moveTo(x, y);
  }
  for (let s = 0; s <= SAMPLES; s++){                       // right
    const t = s / SAMPLES;
    const y = lerp(cornerY[j][i+1], cornerY[j+1][i+1], t);
    path.lineTo(vLines[i+1].at(y / h) + tj(t, 400 + i * 19 + j) + bleed, y);
  }
  for (let s = SAMPLES; s >= 0; s--){                       // bottom
    const t = s / SAMPLES;
    const x = lerp(cornerX[j+1][i], cornerX[j+1][i+1], t);
    path.lineTo(x, hLines[j+1].at(x / w) + tj(t, 300 + (j+1) * 17 + i) + bleed);
  }
  for (let s = SAMPLES; s >= 0; s--){                       // left
    const t = s / SAMPLES;
    const y = lerp(cornerY[j][i], cornerY[j+1][i], t);
    path.lineTo(vLines[i].at(y / h) + tj(t, 400 + i * 19 + j) - bleed, y);
  }
  path.closePath();
  p._paths[key] = path;
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fold layers.
//
// The tone step, the panel lift and the creases don't change between stop-motion
// beats — only the print and the sheet underneath do. So they're baked ONCE into
// three full-canvas layers and blitted, instead of being redrawn every frame.
//
// The layers are built so compositing them is mathematically identical to
// drawing each element in sequence:
//   shadow layer — white ground, elements drawn with 'multiply'  → blit 'multiply'
//   light layer  — black ground, elements drawn with 'screen'    → blit 'screen'
//   tone layer   — mid-grey ground (soft-light identity)         → blit 'soft-light'
// White, black and mid grey are the identities of their operators, so untouched
// regions pass through unchanged.
// ─────────────────────────────────────────────────────────────────────────────
let cache = { key: '', shadow: null, light: null, tone: null };

function layer(w, h, fill){
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  c.fillStyle = fill;
  c.fillRect(0, 0, w, h);
  return { cv, c };
}

// Strokes a fold as ~SAMPLES short segments so width and alpha can breathe along
// its length. A single uniform stroke is what makes a crease read as CSS.
function strokeFold(c, line, vertical, w, h, nx, ny, o){
  const { color, width, alpha, seed, salt, vary, blur } = o;
  if (blur && c.filter !== undefined) c.filter = `blur(${blur}px)`;
  c.strokeStyle = color;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  let px = null, py = null;
  for (let s = 0; s <= SAMPLES; s++){
    const t = s / SAMPLES;
    const x = vertical ? line.at(t) + nx : t * w + nx;
    const y = vertical ? t * h + ny : line.at(t) + ny;
    if (px !== null){
      const n = fbm1(seed, salt, t * 6.2);
      const m = 1 - vary + vary * (n * 1.7);
      const a = alpha * clamp(m, 0, 1.6);
      if (a > 0.002){
        c.globalAlpha = Math.min(1, a);
        c.lineWidth = Math.max(0.35, width * (0.55 + m * 0.75));
        c.beginPath(); c.moveTo(px, py); c.lineTo(x, y); c.stroke();
      }
    }
    px = x; py = y;
  }
  if (c.filter !== undefined) c.filter = 'none';
  c.globalAlpha = 1;
}

export function buildFoldLayers(grid, o){
  const { w, h, seed, vLines, hLines, panels } = grid;
  const { tone, highlight, shadow, width, softness, variance, lift, lightAngle } = o;
  const key = [w, h, grid.cols, grid.rows, seed, grid.jseed, tone, highlight, shadow,
               width, softness, variance, lift, lightAngle].join('|');
  if (cache.key === key) return cache;

  const wantShadow = shadow > 0.001 || lift > 0.001 || tone > 0.001;
  const wantLight = highlight > 0.001 || tone > 0.001;
  const wantTone = tone > 0.001;

  const S = wantShadow ? layer(w, h, '#ffffff') : null;
  const L = wantLight ? layer(w, h, '#000000') : null;
  const T = wantTone ? layer(w, h, '#808080') : null;
  const lx = Math.cos(lightAngle), ly = Math.sin(lightAngle);

  // ── per-panel tone: a flat step plus a gentle ramp toward the fold it leans
  //    into. Both tiny — 2% is what the reference measures — but without them
  //    the sheet collapses into flat collage.
  if (wantTone){
    for (const p of panels){
      const path = panelPath(grid, p, 0, 0.75);
      const step = p.tone * tone * 0.055;
      if (step > 0 && L){
        L.c.save(); L.c.clip(path);
        L.c.globalCompositeOperation = 'screen';
        L.c.globalAlpha = step; L.c.fillStyle = '#ffffff';
        L.c.fillRect(p.x0 - 4, p.y0 - 4, p.w + 8, p.h + 8);
        L.c.restore();
      } else if (step < 0 && S){
        S.c.save(); S.c.clip(path);
        S.c.globalCompositeOperation = 'multiply';
        S.c.globalAlpha = -step; S.c.fillStyle = '#8a8378';
        S.c.fillRect(p.x0 - 4, p.y0 - 4, p.w + 8, p.h + 8);
        S.c.restore();
      }
      const g = T.c.createLinearGradient(
        p.cx - lx * p.w * 0.6, p.cy - ly * p.h * 0.6,
        p.cx + lx * p.w * 0.6, p.cy + ly * p.h * 0.6);
      const k = clamp(tone * 0.5 * (0.6 + p.up * 0.4), 0, 1);
      g.addColorStop(0, `rgba(255,255,255,${0.30 * k})`);
      g.addColorStop(0.5, 'rgba(128,128,128,0)');
      g.addColorStop(1, `rgba(0,0,0,${0.26 * k})`);
      T.c.save(); T.c.clip(path);
      T.c.fillStyle = g;
      T.c.fillRect(p.x0 - 4, p.y0 - 4, p.w + 8, p.h + 8);
      T.c.restore();
    }
  }

  // ── panel lift: the lip of each panel casting onto its neighbour, built as
  //    (offset shapes) MINUS (shapes) so only the overhanging sliver is dark.
  if (lift > 0.001 && S){
    const cut = layer(w, h, 'rgba(0,0,0,0)');
    cut.c.fillStyle = '#2E271F';
    cut.c.save();
    cut.c.translate(-Math.cos(lightAngle) * lift * 5, -Math.sin(lightAngle) * lift * 5);
    for (const p of panels) cut.c.fill(panelPath(grid, p, 0, 0.4));
    cut.c.restore();
    cut.c.globalCompositeOperation = 'destination-out';
    for (const p of panels) cut.c.fill(panelPath(grid, p, 0, 0.4));

    S.c.save();
    S.c.globalCompositeOperation = 'multiply';
    S.c.globalAlpha = Math.min(1, lift * 0.55);
    if (S.c.filter !== undefined) S.c.filter = `blur(${0.6 + lift * 2.4}px)`;
    S.c.drawImage(cut.cv, 0, 0);
    if (S.c.filter !== undefined) S.c.filter = 'none';
    S.c.restore();
  }

  // ── the creases themselves: shadow band on the unlit side, bright ridge hard
  //    against it, and a wide faint bloom for the paper curving away.
  const doLine = (line, vertical, salt) => {
    if (line.weight <= 0) return;
    const wt = line.weight;
    const side = line.mountain ? 1 : -1;
    const nx = vertical ? 1 : -ly * 0.35;
    const ny = vertical ? lx * 0.35 : 1;
    const sgn = side * ((vertical ? lx : ly) >= 0 ? 1 : -1);
    const off = width * (0.85 + softness * 0.9);

    if (shadow > 0.001 && S){
      S.c.globalCompositeOperation = 'multiply';
      strokeFold(S.c, line, vertical, w, h, nx * off * sgn, ny * off * sgn, {
        color: '#5A4B3C', width: width * (1.7 + softness * 2.8),
        alpha: shadow * 0.55 * wt, seed, salt: salt + 1, vary: variance,
        blur: 0.8 + softness * 3.2 });
      strokeFold(S.c, line, vertical, w, h, nx * off * 0.45 * sgn, ny * off * 0.45 * sgn, {
        color: '#3A3026', width: width * 0.95,
        alpha: shadow * 0.48 * wt, seed, salt: salt + 2, vary: variance,
        blur: 0.25 + softness * 0.9 });
    }
    if (highlight > 0.001 && L){
      L.c.globalCompositeOperation = 'screen';
      strokeFold(L.c, line, vertical, w, h, -nx * off * 0.30 * sgn, -ny * off * 0.30 * sgn, {
        color: '#FFF9EC', width: width * 0.78,
        alpha: highlight * 0.72 * wt, seed, salt: salt + 3, vary: variance,
        blur: 0.15 + softness * 0.5 });
      strokeFold(L.c, line, vertical, w, h, -nx * off * 1.5 * sgn, -ny * off * 1.5 * sgn, {
        color: '#FFF3DF', width: width * (2.8 + softness * 3.4),
        alpha: highlight * 0.22 * wt, seed, salt: salt + 4, vary: variance * 0.7,
        blur: 1.6 + softness * 4 });
    }
  };
  vLines.forEach((l, i) => doLine(l, true, 500 + i * 37));
  hLines.forEach((l, j) => doLine(l, false, 900 + j * 37));

  cache = { key, shadow: S && S.cv, light: L && L.cv, tone: T && T.cv };
  return cache;
}

export function paintFoldLayers(ctx, layers){
  const blit = (cv, op) => {
    if (!cv) return;
    ctx.globalCompositeOperation = op;
    ctx.drawImage(cv, 0, 0);
  };
  ctx.save();
  blit(layers.tone, 'soft-light');
  blit(layers.shadow, 'multiply');
  blit(layers.light, 'screen');
  ctx.restore();
}

// ── blocks ───────────────────────────────────────────────────────────────────
// A block is one or more adjacent panels sharing a single image. This is what
// reference A actually does: a photo spans two or three fold panels, and the
// print still jumps at the crease inside it — the sheet was folded AFTER it was
// printed. Grouping 0 = every panel its own image (reference B's bands).
export function buildBlocks(grid, seed, grouping, cap = 4){
  const { cols, rows, panels } = grid;
  const parent = panels.map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  const size = panels.map(() => 1);
  const union = (a, b) => {
    a = find(a); b = find(b);
    if (a === b || size[a] + size[b] > cap) return;
    parent[b] = a; size[a] += size[b];
  };

  if (grouping > 0.001){
    let n = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++){
      const idx = j * cols + i;
      if (i + 1 < cols && hash(seed, n++, 131) < grouping) union(idx, idx + 1);
      if (j + 1 < rows && hash(seed, n++, 137) < grouping) union(idx, idx + cols);
    }
  }

  const byRoot = new Map();
  panels.forEach((p, i) => {
    const r = find(i);
    let b = byRoot.get(r);
    if (!b){
      b = { id: byRoot.size, panels: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity,
            i: p.i, j: p.j };
      byRoot.set(r, b);
    }
    b.panels.push(p);
    b.x0 = Math.min(b.x0, p.x0); b.y0 = Math.min(b.y0, p.y0);
    b.x1 = Math.max(b.x1, p.x0 + p.w); b.y1 = Math.max(b.y1, p.y0 + p.h);
    b.i = Math.min(b.i, p.i); b.j = Math.min(b.j, p.j);
  });

  const blocks = [...byRoot.values()];
  blocks.forEach(b => {
    b.w = b.x1 - b.x0; b.h = b.y1 - b.y0;
    b.cx = (b.x0 + b.x1) / 2; b.cy = (b.y0 + b.y1) / 2;
  });
  // stable reading order so reveal sequencing is predictable
  blocks.sort((a, b) => (a.j - b.j) || (a.i - b.i));
  blocks.forEach((b, k) => { b.id = k; b.panels.forEach(p => p.block = k); });
  return blocks;
}
