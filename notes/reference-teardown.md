# Reference teardown — brik.space "Tactile Press Type"

Source: https://brik.space/toolviewer?slug=tactile-press-type-ms4dto8h
The tool is a single sandboxed <iframe> (blob URL) containing a control schema (JSON)
+ a canvas 2D "creative code" block. Read on 2026-08-22 for structure only; our
implementation is written from scratch.

## Runtime shape
- One `<canvas>`, `requestAnimationFrame` loop.
- Animation time is QUANTIZED: a real-time accumulator ticks a `frameCounter` at
  the chosen FPS (default 6). Everything downstream reads `elapsedSeconds =
  frameCounter / fps`. That single decision is what makes it read as stop-motion.
- Seeded PRNG (mulberry32) + `hash(seed, i, salt)` so every random is reproducible
  from the Random Seed control.

## Section: Paper & Environment
Controls
- Paper Textures — image-picker, multiple (ships 9 scanned sheets)
- Paper Swap Mode — Sequential | Random (default Random)
- Paper Scale — 0.5–3, step .05, default 1.3
- Paper Distortion — 0–3, step .05, default 1
- Paper Lighting — 0–2, step .05, default 0.8
- Lighting Contrast — 0–2, step .05, default 1
- Ink Brightness From Paper — -1–1, step .05, default -1

Mechanics
- Each paper image is preprocessed once into a downsampled "sampler":
  luminance map + Sobel gx/gy gradient maps + mean luminance + 90th-percentile
  highlight (`hi`) + max gradient magnitude.
- On every quantized frame the paper swaps (sequential or seeded-random, never
  repeating the same sheet twice in a row). Drawn `cover` at Paper Scale.
- Paper Distortion: each glyph is rendered to an offscreen buffer, then re-blitted
  in 18 horizontal slices; each slice is offset along the paper's local gradient
  normal (dx full, dy × 0.45), magnitude = fontSize × 0.55 × distortion ×
  min(1, gmag/gmax × 2.2). Ink appears to ride the paper's relief.
- Paper Lighting: same 18 slices, per-slice alpha from how dark the paper is under
  that slice — `darkness = (hi - lum)/hi`, gamma'd by `1 - lightingContrast*0.7`,
  then `alpha = baseAlpha + (darkness - 0.35) * lighting * 1.5`.
- Ink Brightness From Paper: shifts the ink hex lighter/darker by
  `(sampler.mean - 0.5) * 2 * amount * 0.9`, recomputed per frame so ink re-tones
  on each sheet swap.
- Frame→paper UV mapping accounts for the cover-fit crop.

## Section: Animation & Stop-Motion
Controls
- Playing (play/pause), Replay (button), Loop (toggle, default off)
- FPS — 1–30, step 1, default 6
- Converge Duration — 0.1–10s, step .1, default 2.3
- Line Assembly Delay — 0–5s, step .1, default 0.1
- Scatter Radius — 0–1000, step 5, default 415
- Arrival Stagger — 0–1, step .05, default 0.5
- Arrival Order — Scattered | Reading (default Reading)
- Movement Path — Direct | Axis-Locked (default Axis-Locked)
- Avoid Overlap (toggle, on)
- Clear Path (toggle, on)
- Rotate Into Place (toggle, off)

Mechanics
- Layout: glyphs get a target (tx,ty) from normal text layout, then a start
  (sx,sy) on a seeded ring — angle random, radius (0.35 + 0.65·rand) × Scatter
  Radius — clamped to the margin box, then relaxed 14 iterations so scattered
  letters don't sit on top of each other.
- Per glyph the seed also fixes: settle order, tempo (0.8–1.4), easing curve
  exponent (0.75–1.65), wander amp/phase/freq/direction, jitter and rotation
  offsets, ink density, ink-starvation seed.
- Progress: `winT = (elapsed - line*lineDelay) / convergeDuration`.
  - Reading order: each glyph gets a window `[order·spread·0.12, (1-spread)+order·spread]`
    where `spread = 0.25 + stagger·0.6`.
  - Scattered order: start = settleRandom × (stagger·0.7), span = 1 - stagger·0.7.
  - Then `e = easeInOutCubic( min(1, local·tempo) ^ curve )`.
- Axis-Locked path: X interpolates over the first half of e, Y over the second
  half (each eased separately) — the letters move in an L, like a typebar.
- Wander: while `(1-e)²` is non-trivial, the glyph oscillates perpendicular to its
  travel line, amplitude × Scatter Radius, decaying to zero on arrival.
- Avoid Overlap = pairwise separation pass on the live positions each frame.
- Clear Path = pushes settled glyphs out of the corridor a still-travelling glyph
  is moving through.
- Rotate Into Place: extra rotation `startRot·0.5·(1-e)` unwinding as it lands.
- Loop: after total assembly frames + a hold beat of ~1.1s, reset frameCounter.

## Section: Analog Imperfections
Controls
- Baseline Jitter — 0–20, step .5, default 0
- Rotation Jitter — 0–45°, step .5, default 1.5
- Ink Starvation — 0–1, step .01, default 0.35
- Ink Unevenness — 0–1, step .01, default 0.4
- Camera Shake — 0–10, step .1, default 1
- Film Grain — 0–1, step .01, default 0.04
- Random Seed — 1–9999, step 1, default 2301

Mechanics
- Baseline/Rotation Jitter: per-glyph fixed random offsets scaled by the control.
- Ink Starvation: after drawing the glyph into its buffer, punch holes with
  `destination-out` — `18 + starve·70` random discs of radius ~fontSize·0.06,
  alpha `starve·(0.35..1)`, plus `starve·6` thin full-width streaks.
- Ink Unevenness: per-glyph base alpha `1 - uneven·0.5·inkRandom`.
- Camera Shake: applied once per quantized frame to the whole canvas —
  translate ±shake px in x/y, rotate ±0.012·shake rad, around canvas centre.
  Because it only changes on frame ticks it stutters rather than smoothly drifts.
- Film Grain: 220×220 noise tile regenerated per frame from `mulberry32(1000+frame)`,
  tiled at 2.2× with `overlay` blend at `grain·0.8` alpha; plus a radial vignette
  in #3B2F26 whose outer alpha is `grain·130`.

## Things we'd need to supply ourselves
- The 9 paper scans (theirs are hosted assets). Options: our own scans/uploads,
  or procedural paper generation.
- Fonts: they load Special Elite / Courier Prime / Cutive Mono / JetBrains Mono /
  IBM Plex Mono from Google Fonts via the FontFace API.

---

# Reference videos teardown (added 2026-08-22)

Two clips in `notes/`, both 720×1280 @30fps.

## B — "Video from Pinimg (3).mp4" (6s) — BAND SHUFFLE
The frame is cut into ~3 full-width horizontal bands. Each band independently
swaps to a different photograph on the stop-motion beat; bands are NOT
synchronised, so you read it as one image tearing itself apart and reassembling.
A fixed wordmark sits on top, unaffected by the shuffle. Seams between bands are
a 1px light hairline only — no fold, no depth. This is the degenerate case of the
same system: columns = 1, rows = 3.

## A — "Romantic Date Night Ideas.mp4" (17s) — FOLD-GRID COLLAGE
A moodboard printed on a sheet that has been folded into a grid. Measured crease
positions on a 720×1280 frame:
  vertical creases   x ≈ 8, 241, 485, 709   → 3 panel columns
  horizontal creases y ≈ 4, 318, 637, 953, 1272 → 4 panel rows
So a 3 × 4 fold grid. Image blocks pop in and out on the stop-motion beat.

### The thing to crack: depth + "paper ends" at every crease
Measured across the crease at x≈241 (column profile, 0–255 luma):
  left panel  ≈ 213
  ridge spike ≈ 223   (bright hairline, ~1–2px)
  right panel ≈ 218
Three separable signals, all present at once:

1. PANEL TONE STEP. Each fold panel is multiplied by its own slightly different
   brightness — measured ~5/255, i.e. ±2%. Not a flat multiplier: it ramps
   gently across the panel toward its edges (mountain folds brighten toward the
   ridge, valley folds darken into the trough).

2. PANEL CONTENT OFFSET. The printed image is discontinuous at every crease.
   The framed artwork in a_crop2 is displaced ~4–6px horizontally across the
   vertical fold; the chair in a2_z2 is displaced vertically across it. Each
   panel therefore needs its own small transform — a few px translate, a
   fraction of a degree of rotation — applied to its slice of the image.
   THIS is what sells "folded", more than the crease line itself.

3. CREASE = HIGHLIGHT + SHADOW PAIR (the "paper ends" / depth). At each fold:
   a bright 1–2px ridge line, and immediately on the unlit side a soft dark
   band a few px wide falling off to nothing. Which side is lit alternates
   (mountain vs valley) and is randomised per line. Critically the pair
   VARIES ALONG THE LINE — it fades in and out, thickens and thins over its
   length. A uniform stroke reads as CSS; the along-line variation is what
   makes the reference look photographed.

4. CREASES COMPOSITE OVER EVERYTHING. In a2_z1 the fold seam is visible
   running through a pasted tan image block — so the fold layer is drawn last,
   over the collage, not under it. The blocks are printed on the sheet, not
   glued on top of it.

5. BLOCK EDGES. Collage blocks get a thin darker contact line on their
   light-facing edges plus a soft cast shadow offset away from the light
   (down-right in the reference). Some edges are slightly irregular/torn
   rather than a clean cut.

### Unification
A and B are one system with different segment counts:
  B = 1 column × 3 rows, fold depth off, seam highlight only
  A = 3 columns × 4 rows, fold depth on
So the app needs Columns and Rows as the segment control, and the fold/depth
treatment as a group that can be dialled to zero.
