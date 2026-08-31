// Analog imperfections: print wear, camera shake, film grain, vignette.
import { mulberry32, hash, clamp } from './rng.js';

const VIGNETTE = '#3B2F26';

// Print wear — where the press didn't take.
//
// This started as discs punched out with destination-out, which is right for
// type (a bite out of a letterform reads as ink failing) but wrong for a photo:
// on a flat field they read as perfect circles, i.e. bubbles. Wear is now a
// 2D value-noise field, thresholded so only its peaks break through. That gives
// irregular patches with ragged edges that merge as the amount climbs.
const h2 = (seed, xi, yi) => hash(seed, (xi * 1836311 + yi * 2971215) | 0, 17);

function valueNoise2(seed, x, y){
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(seed, xi, yi),     b = h2(seed, xi + 1, yi);
  const c = h2(seed, xi, yi + 1), d = h2(seed, xi + 1, yi + 1);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}

function fbm2(seed, x, y, oct = 3){
  let sum = 0, amp = 1, norm = 0, fx = x * 0.45, fy = y;
  for (let o = 0; o < oct; o++){
    sum += valueNoise2(seed + o * 131, fx, fy) * amp;
    norm += amp; amp *= 0.5; fx *= 2.1; fy *= 2.1;
  }
  return sum / norm;
}

const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// Print unevenness — a slow density drift across the sheet, as if the ink film
// wasn't laid down at a constant thickness. Broad and low-frequency, so a
// handful of noise cells is plenty.
// UNEVENNESS is the opposite scale — a slow density drift across the whole
// sheet — so a handful of noise cells is plenty.
let uMask = null, ubx = null, uKey = '';
function unevenMask(o, cw, ch){
  const { unevenness, seed } = o;
  const key = [unevenness, seed, cw, ch].join('|');
  if (uMask && uKey === key) return uMask;
  if (!uMask){ uMask = document.createElement('canvas'); ubx = uMask.getContext('2d'); }
  const mw = 96, mh = Math.max(32, Math.round(96 * ch / cw));
  if (uMask.width !== mw || uMask.height !== mh){ uMask.width = mw; uMask.height = mh; }

  const img = ubx.createImageData(mw, mh);
  const d = img.data;
  const uSeed = (seed * 104729 + 17) >>> 0;
  for (let y = 0; y < mh; y++){
    for (let x = 0; x < mw; x++){
      const v = fbm2(uSeed, x * 0.045, y * 0.045, 2);
      const a = smoothstep((v - 0.46) / 0.34) * unevenness * 110;
      const p = (y * mw + x) * 4;
      d[p] = d[p+1] = d[p+2] = 0;
      d[p+3] = a > 255 ? 255 : a;
    }
  }
  ubx.putImageData(img, 0, 0);
  uKey = key;
  return uMask;
}

let starveBuf = null, stx = null;
export function applyPrintWear(src, o, cw, ch){
  const { unevenness } = o;
  if (unevenness <= 0.001) return src;
  if (!starveBuf){ starveBuf = document.createElement('canvas'); stx = starveBuf.getContext('2d'); }
  if (starveBuf.width !== cw || starveBuf.height !== ch){ starveBuf.width = cw; starveBuf.height = ch; }
  stx.clearRect(0, 0, cw, ch);
  stx.drawImage(src, 0, 0);

  stx.save();
  stx.globalCompositeOperation = 'destination-out';
  stx.imageSmoothingEnabled = true;
  stx.imageSmoothingQuality = 'high';
  stx.drawImage(unevenMask(o, cw, ch), 0, 0, cw, ch);
  stx.restore();
  return starveBuf;
}

// Camera shake only changes on a quantized frame tick, so it stutters like a
// rostrum camera instead of drifting like a smooth transform.
export function shakeFor(seed, frame, amount){
  return {
    x: (hash(seed, frame, 11) - 0.5) * 2 * amount,
    y: (hash(seed, frame, 12) - 0.5) * 2 * amount,
    r: (hash(seed, frame, 13) - 0.5) * 0.010 * amount
  };
}

const grainBuf = document.createElement('canvas');
const grx = grainBuf.getContext('2d');
let grainFrame = -1, grainStrength = -1;
function paintGrain(strength, frame){
  if (grainFrame === frame && grainStrength === strength) return;
  grainFrame = frame; grainStrength = strength;
  const g = 240;
  grainBuf.width = g; grainBuf.height = g;
  const img = grx.createImageData(g, g);
  const d = img.data;
  const rng = mulberry32((1000 + frame) >>> 0);
  for (let i = 0; i < d.length; i += 4){
    const v = rng() * 255;
    d[i] = d[i+1] = d[i+2] = v;
    d[i+3] = rng() * 92 * strength;
  }
  grx.putImageData(img, 0, 0);
}

export function paintGrainAndVignette(ctx, o, cw, ch){
  const { grain, vignette, frame } = o;
  if (vignette > 0.001){
    const g = ctx.createRadialGradient(cw/2, ch/2, Math.min(cw,ch) * 0.34,
                                       cw/2, ch/2, Math.max(cw,ch) * 0.74);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, VIGNETTE + Math.floor(clamp(vignette,0,1) * 150).toString(16).padStart(2,'0'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  }
  if (grain <= 0.001) return;
  paintGrain(grain, frame);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(1, grain * 0.85);
  const s = 2.0;
  for (let y = 0; y < ch; y += grainBuf.height * s)
    for (let x = 0; x < cw; x += grainBuf.width * s)
      ctx.drawImage(grainBuf, x, y, grainBuf.width * s, grainBuf.height * s);
  ctx.restore();
}
