# Paper Image Shuffle

Stop-motion image shuffling on folded, swapping paper. Canvas 2D, no build step.

## Run

Double-click `index.html`. That's it — one self-contained file, no server, no
build step, nothing external except the Google Fonts stylesheet (which falls
back to the system mono if you're offline).

Drag images onto the window to add your own; the demo set is pulled from the
reference clips in `notes/`.

Space = play/pause. `r` = restart the timeline.

Settings persist across refreshes in `localStorage`. Each section header has a
reset (hover the header to reveal it) that snaps that section back to the
original schema defaults; **Reset** in the panel header does the whole panel and
drops the stored copy. Both offer an Undo in the toast rather than asking for
confirmation first.

### Images

The bundled demo set is a placeholder. Adding even one image of your own clears
every placeholder immediately, and they stay gone across refreshes — a reload
never resurrects images you deliberately replaced. Adding more after that
appends rather than replacing. **Clear** empties the list; **Demo set** brings
the placeholders back and lets them persist again. Deleting a placeholder by
hand counts as dismissing it too.

Your own images aren't persisted — object URLs don't survive a refresh — so once
the placeholders are dismissed a reload opens on a bare folded sheet. Canvas size
and every panel control are persisted.

Stored values are re-validated against the schema on load: wrong type, out of
range, or an option that no longer exists gets dropped and the default used. A
stale store from an older build can't brick the panel.

## Sharing a session

**Share** in the panel footer packs the whole document — every control value, the
canvas size and the images — and returns two links:

- `/s/<id>` — **editable**. All dials open. Reset returns to *that session's*
  settings rather than the app defaults, because the session is the document.
- `/v/<id>` — **play only**. No panel, no size bar, canvas fills the window.

**The URLs are permanent.** A session's id never changes. Opening the editable
link puts the app in session mode:

- Edits are live but **transient**. Nothing is written to localStorage, so
  closing or reloading without saving discards them and the saved session comes
  back. The browser warns before you leave with unsaved edits, and the panel
  carries a rose outline while they're pending.
- **Save** writes back to the same id, replacing what the links point at. It's
  disabled until something actually changes, and reads `Save *` when it does.
- **Reset** returns to the saved session, not the app defaults. After a save,
  that becomes the new target.
- **Share** publishes a *new* session; Save updates this one.

Overwriting is gated on an edit key generated at publish time — only its SHA-256
is stored, and a wrong key is rejected in constant time. The **editable link
carries the key**, so anyone you send it to can overwrite the session; the
play-only link cannot. Open the editable link without its key and the dials work
but Save is hidden.

Demo images are stored by index rather than by bytes (they're already in the
page), so a demo-only session is a couple of KB. Uploaded images are re-encoded
to 1800px JPEG before travelling.

Sharing needs the app served over http(s); from a double-clicked local file the
button explains that and does nothing.

### Deploying

The Worker serves the app *and* the session API, so it's one deploy. You need a
Cloudflare account (the free tier covers this).

```bash
npx wrangler login
npx wrangler r2 bucket create paper-image-shuffle-sessions
npx wrangler deploy
```

To run it locally with simulated R2 first:

```bash
npx wrangler dev --local --port 4740
```

`worker/src/index.js` is the whole backend: `POST /api/session` writes one R2
object and returns an id, `GET /api/session/<id>` reads it back, and everything
else falls through to the static app. `/s/<id>` and `/v/<id>` resolve to
index.html via `not_found_handling = "single-page-application"`, and
`run_worker_first = ["/api/*"]` keeps the API from being swallowed by that.

**Anyone with a link can open it.** Sessions are unlisted, not private — the ids
are random 10-character strings, but there's no auth. Don't share images you
wouldn't put on the open web.

## Editing

`index.html` is **generated** — don't edit it directly. The readable source is
in `src/`, and the images live in `assets/`. After changing either:

```bash
python3 build.py
```

That inlines the CSS, flattens the ES modules into one classic script, and
embeds every image as a data URI. Data URIs rather than relative paths matter:
they keep the canvas untainted, so the paper sampler's `getImageData` and Save
PNG both work when the page is opened from the filesystem.

## How it works

Time is **quantized**. A real-time accumulator ticks a frame counter at the chosen
FPS (default 6) and nothing — paper swap, segment swap, camera shake, grain —
moves between ticks. That single decision is what reads as stop-motion rather
than as animation. Every random value comes from a seeded PRNG keyed on the
Random Seed control, so a sheet is reproducible forever.

### Segments, blocks, folds

The sheet is divided into a **fold grid** of Columns × Rows. Adjacent panels can
merge into **blocks** (the Grouping control) that share one image — that's what
reference A does: a photo spans two or three fold panels, and the print still
jumps at the crease inside it, because the sheet was folded *after* it was
printed. Grouping at 0 gives one image per panel, which with Columns 1 is
reference B's horizontal band shuffle.

### Modes

- **Assemble** — blocks fade/snap in on a staggered schedule, then loop.
- **Shuffle** — every block independently swaps images on its own beat. Blocks
  are unsynchronised, so the sheet churns.
- **Assemble + Shuffle** — assemble once, then churn.
- **Sweep** — strictly sequential, the way the references move. One image lays
  itself down one tile at a time in reading order (row by row, then down). Only
  when the **last** tile has landed, plus a hold, does the next image begin
  laying over it from the top-left again.

Sweep is driven straight off the frame counter rather than per-block state, so
it can't drift: at tick `t`, tile `rank < t % cycleLen` shows the current image
and everything else still shows the previous one. `Tile Beat` sets frames per
tile, `Sweep Hold` the pause on a completed image. With Loop off it settles on
the last image instead of cycling.

`Order` applies to Sweep as well as Assemble — reading, columns, centre-out or
scattered. Reading is what the references use.

**Grouping and Max Block are locked off in Sweep.** A merged block gets one rank
from its top-left cell but covers several, so a block anchored in row 0 spanning
into row 1 would fill part of row 1 before row 0 had finished — which destroys
the row-by-row read the mode exists for. The controls grey out and display the
values in force (0 and 1); the values you had are kept and come back when you
leave Sweep.

### The depth / paper-ends effect

Three separable signals, all measured off the reference footage:

1. **Panel tone step** — each panel sits at its own brightness (~±2% in the
   reference) plus a gentle ramp toward the fold it leans into.
2. **Panel content offset** — the print is discontinuous across every crease.
   Each panel translates and rotates its slice by a few px. This sells "folded"
   more than the crease line does.
3. **Ridge light + ridge shadow** — a bright 1–2px highlight with a soft dark
   band on the unlit side, drawn with `screen` / `multiply` so they modulate the
   print instead of painting over it. Critically both **vary along the line**,
   driven by 1D fractal noise: they fade in and out and thicken and thin over
   the length. A uniform stroke reads as CSS; the variation is the whole trick.

**Panel Lift** adds the overhang shadow — built as (offset panel shapes) minus
(panel shapes) so only the sliver that actually overhangs goes dark.

### Performance

Two decisions do all the work:

**Draw only when something changes.** The animation is quantized to `fps`, so at
the default 6 a 60Hz redraw throws away nine frames in ten. A dirty flag is set
by a quantized beat, a control change, a resize or an image being added — the
rAF loop keeps running but only calls `render()` when the flag is up.

**Bake the fold layers.** Panel tone, panel lift and the creases don't change
between beats; only the print and the sheet do. They're built once into three
full-canvas layers and blitted:

| layer  | ground   | composited with | why that ground |
|--------|----------|-----------------|-----------------|
| shadow | white    | `multiply`      | white is multiply's identity |
| light  | black    | `screen`        | black is screen's identity |
| tone   | mid grey | `soft-light`    | mid grey is soft-light's identity |

Elements are drawn *into* each layer with the same operator they'd be composited
with, which makes the result mathematically identical to drawing them one at a
time onto the canvas — but it pays the blur cost once per control change instead
of once per frame. Blurred strokes were the single most expensive thing here.

Panel outlines are cached `Path2D` objects rather than ~200 `lineTo` calls each
time, and the relief lattice scales its cell size with the canvas so a 1080×1920
sheet doesn't cost 3000 `drawImage` calls.

Measured at 1080×1920: ~6.5 ms per stop-motion beat, ~6 ms to rebuild the fold
layers when a depth control moves. At 6 fps that's roughly 4% of one core.

### Paper

Each sheet is preprocessed into a sampler (luminance, Sobel gradients, mean,
90th-percentile paper-white). The print is then pressed into it:

- **Paper Distortion** re-blits the printed layer as a lattice, each cell nudged
  along the paper's local gradient, so the print rides the relief.
- **Paper Lighting** bakes a *shade map* — the sheet renormalised so its own
  paper-white sits at mid grey — composited with `overlay`, where mid grey is a
  no-op. Only the sheet's own creases, stains and fibre press through.

A new sheet is picked every quantized frame, so the print re-lights on each swap.

## Files

- `index.html` — the built app (generated; 1.0 MB with assets embedded)
- `build.py` — inlines `src/` + `assets/` into `index.html`
- `src/folds.js` — fold grid, panel paths, blocks, crease depth
- `src/paper.js` — sheet loading, sampler, relief warp, shade map
- `src/imperfections.js` — print wear, camera shake, grain, vignette
- `src/controls.js` — panel UI + state
- `src/app.js` — schema, timeline, render loop
- `src/session.js` — session serialise / publish / load / routing
- `src/template.html`, `src/app.css` — shell and styles
- `worker/src/index.js`, `wrangler.toml` — Cloudflare Worker + R2 session store
- `public/index.html` — generated; what the Worker serves
- `notes/reference-teardown.md` — measurements from both references
- `assets/paper/SOURCE_URLS.txt` — provenance of the paper scans (licence unknown)
