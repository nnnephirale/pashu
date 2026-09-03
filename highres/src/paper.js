// Paper sheet: loading, per-sheet relief/lighting sampler, and the passes that
// press the printed image into the sheet.
import { clamp } from './rng.js';

const SAMPLE_W = 220;
const sampleBuf = document.createElement('canvas');
const sbx = sampleBuf.getContext('2d', { willReadFrequently: true });

// Hi-res build only: assets are linked from disk, not embedded. Browsers cache
// images hard, so a plain refresh would keep showing the OLD paper after you
// edit the PNG. Stamp on-disk asset URLs with a per-page-load token so every
// refresh refetches — edits show up immediately. Uploads (blob:) and any data:
// URIs are left untouched.
const LOAD_BUST = Date.now();
export function loadImage(src){
  // Only the linked on-disk assets, and only when served over http(s): stamp a
  // per-load token so an edited PNG shows on refresh, and mark them crossOrigin
  // so the canvas stays exportable. Over file:// we skip both (a query on a
  // file URL can break the fetch, and crossOrigin is meaningless there); and we
  // NEVER set crossOrigin on blob:/data: uploads — that makes some browsers
  // refuse to decode them ("could not read those files").
  const isAsset = /^(\.\.\/)?assets\//.test(src);
  const isHttp = location.protocol.startsWith('http');
  if (isAsset && isHttp) src += (src.includes('?') ? '&' : '?') + 'v=' + LOAD_BUST;
  return new Promise((res, rej) => {
    const im = new Image();
    if (isAsset && isHttp) im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

// Precompute once per sheet: luminance, Sobel gradients, mean, and the 90th
// percentile as the "paper white" reference.
export function buildSampler(img){
  if (!img || !img.complete || !img.naturalWidth) return null;
  const ar = img.naturalWidth / img.naturalHeight;
  let sw = SAMPLE_W, sh = SAMPLE_W;
  if (ar >= 1) sh = Math.max(8, Math.round(SAMPLE_W / ar));
  else sw = Math.max(8, Math.round(SAMPLE_W * ar));
  sampleBuf.width = sw; sampleBuf.height = sh;
  sbx.clearRect(0, 0, sw, sh);
  try {
    sbx.drawImage(img, 0, 0, sw, sh);
    const data = sbx.getImageData(0, 0, sw, sh).data;
    const n = sw * sh;
    const lum = new Float32Array(n);
    const hist = new Float32Array(64);
    let mean = 0;
    for (let i = 0; i < n; i++){
      const p = i * 4;
      const l = (0.299 * data[p] + 0.587 * data[p+1] + 0.114 * data[p+2]) / 255;
      lum[i] = l; mean += l;
      hist[Math.min(63, (l * 64) | 0)]++;
    }
    mean /= n;
    let acc = 0, hi = 1;
    for (let b = 0; b < 64; b++){ acc += hist[b]; if (acc >= n * 0.9){ hi = (b + 0.5) / 64; break; } }
    const gx = new Float32Array(n), gy = new Float32Array(n);
    const at = (x, y) => lum[clamp(y,0,sh-1) * sw + clamp(x,0,sw-1)];
    let gmax = 1e-4;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++){
      const i = y * sw + x;
      gx[i] = (at(x+1,y-1)+2*at(x+1,y)+at(x+1,y+1)) - (at(x-1,y-1)+2*at(x-1,y)+at(x-1,y+1));
      gy[i] = (at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1)) - (at(x-1,y-1)+2*at(x,y-1)+at(x+1,y-1));
      const m = Math.hypot(gx[i], gy[i]);
      if (m > gmax) gmax = m;
    }
    return { w: sw, h: sh, lum, gx, gy, mean, hi, gmax };
  } catch { return null; }
}

// canvas pixel -> paper uv, accounting for the cover-fit crop
export function frameToPaperUV(fx, fy, img, scale, cw, ch){
  const sw = cw * scale, sh = ch * scale;
  const ox = (cw - sw) / 2, oy = (ch - sh) / 2;
  let u = (fx - ox) / sw, v = (fy - oy) / sh;
  const iar = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
  const dar = sw / sh;
  if (iar > dar) u = 0.5 + (u - 0.5) * (dar / iar);
  else           v = 0.5 + (v - 0.5) * (iar / dar);
  return [u, v];
}

export function sampleAt(s, u, v){
  const x = clamp((u * s.w) | 0, 0, s.w - 1);
  const y = clamp((v * s.h) | 0, 0, s.h - 1);
  const i = y * s.w + x;
  return { lum: s.lum[i], gx: s.gx[i], gy: s.gy[i] };
}

export function drawCover(ctx, img, x, y, w, h){
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const ir = iw / ih;
  const dr = w / h;
  let sw, sh, sx, sy;
  if (ir > dr){ sh = ih; sw = sh * dr; sx = (iw - sw) / 2; sy = 0; }
  else        { sw = iw; sh = sw / dr; sx = 0; sy = (ih - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

export function drawSheet(ctx, img, scale, cw, ch){
  const sw = cw * scale, sh = ch * scale;
  drawCover(ctx, img, (cw - sw) / 2, (ch - sh) / 2, sw, sh);
}

// ── pressing the print into the sheet ────────────────────────────────────────
// Grid warp: the printed layer is re-blitted as a lattice, each cell nudged
// along the paper's local gradient. This is what makes ink ride the relief
// instead of floating flat on top of it.
let warpBuf = null, wbx = null;
export function reliefWarp(src, sampler, img, amount, paperScale, cw, ch){
  if (!sampler || !img || amount <= 0.001) return src;
  if (!warpBuf){ warpBuf = document.createElement('canvas'); wbx = warpBuf.getContext('2d'); }
  if (warpBuf.width !== cw || warpBuf.height !== ch){ warpBuf.width = cw; warpBuf.height = ch; }
  wbx.clearRect(0, 0, cw, ch);

  // cell size scales with the sheet so a big canvas doesn't cost 3000 blits
  const CELL = Math.max(26, Math.round(Math.hypot(cw, ch) / 44));
  const maxShift = amount * 3.2;
  const nx = Math.ceil(cw / CELL), ny = Math.ceil(ch / CELL);
  for (let j = 0; j < ny; j++){
    for (let i = 0; i < nx; i++){
      const sx = i * CELL, sy = j * CELL;
      const wgt = Math.min(CELL, cw - sx), hgt = Math.min(CELL, ch - sy);
      if (wgt <= 0 || hgt <= 0) continue;
      const [u, v] = frameToPaperUV(sx + wgt / 2, sy + hgt / 2, img, paperScale, cw, ch);
      const s = sampleAt(sampler, u, v);
      const g = Math.hypot(s.gx, s.gy);
      let dx = 0, dy = 0;
      if (g > 1e-5){
        const k = Math.min(1, (g / sampler.gmax) * 2.2);
        dx = (s.gx / g) * maxShift * k;
        dy = (s.gy / g) * maxShift * k;
      }
      // 1px bleed keeps the lattice from showing as a seam grid
      wbx.drawImage(src, sx, sy, wgt, hgt, sx + dx - 0.5, sy + dy - 0.5, wgt + 1, hgt + 1);
    }
  }
  return warpBuf;
}

// The sheet's own shadows darken whatever is printed on it. Rather than
// per-cell fills (blocky, slow) we bake a SHADE MAP per sheet: the paper
// renormalised so its own paper-white sits at mid grey. Composited with
// 'overlay', mid grey is a no-op, so only the sheet's deviations — creases,
// stains, fibre — press through into the print. Re-derived per swap, so the
// print re-lights every time the paper changes.
const shadeCache = new WeakMap();
export function buildShadeMap(img, sampler, contrast){
  const key = Math.round(contrast * 20);
  let per = shadeCache.get(img);
  if (per && per.key === key) return per.canvas;

  const sw = sampler.w, sh = sampler.h;
  const cv = document.createElement('canvas');
  cv.width = sw; cv.height = sh;
  const cx = cv.getContext('2d');
  const out = cx.createImageData(sw, sh);
  const d = out.data;
  const k = 255 * (0.75 + contrast * 1.15);
  const ref = sampler.hi * 0.82 + sampler.mean * 0.18;
  for (let i = 0; i < sw * sh; i++){
    let v = 128 + (sampler.lum[i] - ref) * k;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    const p = i * 4;
    d[p] = d[p+1] = d[p+2] = v; d[p+3] = 255;
  }
  cx.putImageData(out, 0, 0);
  per = { key, canvas: cv };
  shadeCache.set(img, per);
  return cv;
}

export function paintPaperLight(ctx, sampler, img, o, cw, ch){
  const { lighting, contrast, paperScale } = o;
  if (!sampler || !img || lighting <= 0.001) return;
  const map = buildShadeMap(img, sampler, contrast);
  const sw = cw * paperScale, sh = ch * paperScale;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(1, lighting * 0.62);
  drawCover(ctx, map, (cw - sw) / 2, (ch - sh) / 2, sw, sh);
  ctx.restore();
}
