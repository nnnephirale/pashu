// Subject cutout — background removal via transformers.js + BRIA RMBG-1.4,
// running entirely in the browser (WASM). Nothing is uploaded anywhere.
//
// The library and the ~44MB model are fetched from a CDN the first time a
// cutout is asked for, then cached by the browser. That means the feature needs
// a network connection on first use and simply stays unavailable offline — the
// app falls back to the whole image. Model choice and pre/post-processing follow
// Addy Osmani's bg-remove reference implementation.

const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm';
const MODEL_ID = 'briaai/RMBG-1.4';

let lib = null;        // the imported module
let model = null;      // the loaded RMBG model
let processor = null;  // its image processor
let loadPromise = null;

// Load the library and model exactly once. `onProgress(fraction, label)` is
// called during the (slow, first-time) download so the UI can show a bar.
export function ensureModel(onProgress){
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    lib = await import(CDN);
    const { env, AutoModel, AutoProcessor } = lib;
    env.allowLocalModels = false;
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.proxy = true;
    model = await AutoModel.from_pretrained(MODEL_ID, {
      progress_callback: (p) => {
        if (onProgress && p.status === 'progress' && typeof p.progress === 'number')
          onProgress(p.progress / 100, p.file || '');
      },
    });
    processor = await AutoProcessor.from_pretrained(MODEL_ID, {
      config: {
        do_normalize: true, do_pad: true, do_rescale: true, do_resize: true,
        image_mean: [0.5, 0.5, 0.5], feature_extractor_type: 'ImageFeatureExtractor',
        image_std: [0.5, 0.5, 0.5], resample: 2,
        rescale_factor: 0.00392156862745098, size: { width: 1024, height: 1024 },
      },
    });
    return true;
  })().catch((err) => { loadPromise = null; throw err; });   // let a retry re-arm
  return loadPromise;
}

// Tight bounding box of the visible pixels (alpha above a small threshold).
// Sampled on a stride — exactness isn't needed, just a snug frame for placement.
function alphaBounds(data, w, h){
  let minX = w, minY = h, maxX = 0, maxY = 0, any = false;
  const step = Math.max(1, Math.round(Math.min(w, h) / 400));
  for (let y = 0; y < h; y += step){
    for (let x = 0; x < w; x += step){
      if (data[(y * w + x) * 4 + 3] > 12){
        any = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!any) return { x: 0, y: 0, w, h };
  // pad by one stride so the stride-sampling never clips the true edge
  minX = Math.max(0, minX - step); minY = Math.max(0, minY - step);
  maxX = Math.min(w - 1, maxX + step); maxY = Math.min(h - 1, maxY + step);
  return { x: minX, y: minY, w: (maxX - minX + 1), h: (maxY - minY + 1) };
}

// The raw matte often carries faint halos and scattered specks (stray text,
// background texture the model half-kept). Left alone, the paper-edge builder
// wraps a torn white border around every wisp and the result reads as glitchy
// wireframe. So: binarise the matte, keep only the single largest connected
// region, and paint the original soft alpha back inside just that region —
// killing the specks while keeping clean, feathered edges on the real subject.
// Returns the cleaned alpha and the kept area (in pixels) for a coverage check.
function cleanMask(mask, w, h){
  const N = w * h;
  const bin = new Uint8Array(N);
  for (let i = 0; i < N; i++) bin[i] = mask[i] >= 128 ? 1 : 0;

  const label = new Int32Array(N);   // 0 = unvisited
  const stack = new Int32Array(N);
  let cur = 0, bestLabel = 0, bestSize = 0;
  for (let s = 0; s < N; s++){
    if (!bin[s] || label[s]) continue;
    cur++; let size = 0, sp = 0;
    stack[sp++] = s; label[s] = cur;
    while (sp){
      const p = stack[--sp]; size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0     && bin[p-1] && !label[p-1]){ label[p-1] = cur; stack[sp++] = p-1; }
      if (x < w-1   && bin[p+1] && !label[p+1]){ label[p+1] = cur; stack[sp++] = p+1; }
      if (y > 0     && bin[p-w] && !label[p-w]){ label[p-w] = cur; stack[sp++] = p-w; }
      if (y < h-1   && bin[p+w] && !label[p+w]){ label[p+w] = cur; stack[sp++] = p+w; }
    }
    if (size > bestSize){ bestSize = size; bestLabel = cur; }
  }

  const out = new Uint8Array(N);
  if (bestLabel) for (let i = 0; i < N; i++) if (label[i] === bestLabel) out[i] = mask[i];
  return { alpha: out, area: bestSize };
}

// There is ONE model / WASM session, and it cannot run two inferences at once —
// overlapping calls corrupt each other's output (the "glitchy" cutouts). Every
// request is therefore chained onto a single queue so they run strictly one at
// a time, however many the caller fires off.
let queue = Promise.resolve();
async function runInference(src){
  const { RawImage } = lib;
  const img = await RawImage.fromURL(src);
  const { pixel_values } = await processor(img);
  const { output } = await model({ input: pixel_values });
  const raw = (await RawImage.fromTensor(output[0].mul(255).to('uint8'))
                  .resize(img.width, img.height)).data;
  const { alpha, area } = cleanMask(raw, img.width, img.height);

  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img.toCanvas(), 0, 0);
  const id = ctx.getImageData(0, 0, img.width, img.height);
  for (let i = 0; i < alpha.length; i++) id.data[4 * i + 3] = alpha[i];
  ctx.putImageData(id, 0, 0);

  return {
    canvas,
    bbox: alphaBounds(id.data, img.width, img.height),
    coverage: area / (img.width * img.height),   // how much of the frame the subject fills
  };
}

// Cut the subject out of `src` (a URL or data URI). Resolves to a canvas the
// size of the source image with the background erased, plus the subject's
// bounding box within it. Throws if the model can't load (offline / blocked).
export function cutout(src, onProgress){
  const run = queue.then(async () => {
    await ensureModel(onProgress);
    return runInference(src);
  });
  // keep the chain alive even if this job throws, so one failure doesn't wedge
  // every job queued behind it
  queue = run.catch(() => {});
  return run;
}
