// Seeded, reproducible randomness. Same seed => same sheet, forever.
export function mulberry32(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stateless hash: one deterministic value per (seed, index, salt) triple.
export function hash(seed, i, salt){
  return mulberry32((seed * 374761393 + i * 668265263 + salt * 2246822519) >>> 0)();
}

// Signed variant, -1..1
export function shash(seed, i, salt){ return hash(seed, i, salt) * 2 - 1; }

// Smooth 1D value noise — used for variation ALONG a crease so the highlight
// breathes instead of running at one constant weight.
export function noise1(seed, salt, t){
  const i = Math.floor(t), f = t - i;
  const a = hash(seed, i, salt), b = hash(seed, i + 1, salt);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

// Fractal version — two octaves is enough to stop it reading as a sine wave.
export function fbm1(seed, salt, t){
  return noise1(seed, salt, t) * 0.65 + noise1(seed, salt + 977, t * 2.7) * 0.35;
}

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOutCubic = (t) => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
