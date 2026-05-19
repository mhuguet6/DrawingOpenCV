/**
 * OpenCV.js worker.
 *
 * Runs on its own thread so the ~8 MB WASM module's compile does NOT freeze
 * the main thread. Loaded by Vite via:
 *
 *   new Worker(new URL('./cvWorker.js', import.meta.url))
 *
 * Protocol: simple id-based RPC.
 *   main → worker:  { id, type, payload }
 *   worker → main:  { id, result }   |   { id, error }
 *
 * Supported types:
 *   - 'init'            kicks off OpenCV load; resolves when cv.Mat is ready
 *   - 'classify-shape'  { width, height, buffer } → { label, confidence, scores }
 */

/* eslint-disable no-restricted-globals */

// Prefer a locally-built minimal OpenCV.js (~1.5-2 MB) if available — the
// CDN build is ~8 MB and 4-5x slower to compile. Build the local version
// with `./scripts/build-opencv.sh`; until you do, we transparently fall
// back to the CDN so nothing breaks.
const LOCAL_URL = '/opencv-min.js';
const CDN_URL   = 'https://docs.opencv.org/4.10.0/opencv.js';

let cvReadyPromise = null;

/**
 * Check whether the local minimal build exists.
 *
 * Naive `res.ok` is insufficient: Vite's dev server returns index.html
 * (HTTP 200, text/html) for any missing route in SPA mode, so a HEAD
 * request to /opencv-min.js succeeds even when the file isn't there.
 * Also check the Content-Type to confirm we got JS, not HTML.
 */
async function isLocalBuildAvailable() {
  try {
    const res = await fetch(LOCAL_URL, { method: 'HEAD' });
    if (!res.ok) return false;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    return ct.includes('javascript') || ct.includes('ecmascript');
  } catch {
    return false;
  }
}

function loadCv() {
  if (cvReadyPromise) return cvReadyPromise;
  cvReadyPromise = (async () => {
    // Pick a source, then importScripts. If the local script ends up being
    // unusable for any reason (corrupt, wrong content-type slipped through,
    // etc.), fall back to the CDN as a safety net.
    let url = (await isLocalBuildAvailable()) ? LOCAL_URL : CDN_URL;
    try {
      importScripts(url);
    } catch (err) {
      if (url !== CDN_URL) {
        // eslint-disable-next-line no-console
        console.warn('[cvWorker] local build failed, falling back to CDN:', err);
        url = CDN_URL;
        importScripts(url);
      } else {
        throw err;
      }
    }
    self.postMessage({ kind: 'cv-source', url });
    await new Promise((resolve) => {
      const tryResolve = () => {
        if (self.cv && self.cv.Mat) {
          resolve();
        } else if (self.cv) {
          self.cv.onRuntimeInitialized = () => resolve();
        } else {
          setTimeout(tryResolve, 30);
        }
      };
      tryResolve();
    });
    return self.cv;
  })();
  return cvReadyPromise;
}

self.addEventListener('message', async (e) => {
  const { id, type, payload } = e.data ?? {};
  try {
    if (type === 'init') {
      await loadCv();
      self.postMessage({ id, result: true });
      return;
    }
    if (type === 'classify-shape') {
      const cv = await loadCv();
      const result = classifyShape(cv, payload);
      self.postMessage({ id, result });
      return;
    }
    throw new Error(`Unknown worker message type: ${type}`);
  } catch (err) {
    self.postMessage({ id, error: err?.message ?? String(err) });
  }
});

/**
 * Shape detection — same pipeline as the previous main-thread version.
 *
 *   ImageData → cv.matFromImageData
 *             → cvtColor(GRAY) → threshold (binary)
 *             → findContours(RETR_EXTERNAL)
 *             → pick largest contour by area
 *             → arcLength + contourArea → circularity
 *             → approxPolyDP(ε = 4% of perimeter) → corner count
 *             → boundingRect → aspect ratio + bbox fill
 *             → score circle / square / triangle → highest wins
 *
 * Every cv.Mat is .delete()'d in finally — emscripten heap is not GC'd.
 */
function classifyShape(cv, { width, height, buffer }) {
  if (!width || !height || !buffer) return null;
  const imageData = new ImageData(
    new Uint8ClampedArray(buffer),
    width,
    height,
  );

  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  const binary = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const approx = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.threshold(gray, binary, 30, 255, cv.THRESH_BINARY);
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    if (contours.size() === 0) return null;

    let largestIdx = 0;
    let largestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const a = cv.contourArea(contours.get(i));
      if (a > largestArea) {
        largestArea = a;
        largestIdx = i;
      }
    }
    if (largestArea < 50) return null; // ignore specks
    const c = contours.get(largestIdx);

    const perimeter = cv.arcLength(c, true);
    if (perimeter < 1) return null;
    const circularity = (4 * Math.PI * largestArea) / (perimeter * perimeter);

    cv.approxPolyDP(c, approx, 0.04 * perimeter, true);
    const corners = approx.rows;

    const bbox = cv.boundingRect(c);
    const aspect =
      bbox.width > 0 && bbox.height > 0
        ? Math.min(bbox.width, bbox.height) / Math.max(bbox.width, bbox.height)
        : 0;
    const fill =
      bbox.width * bbox.height > 0
        ? largestArea / (bbox.width * bbox.height)
        : 0;

    const scores = {
      circle: scoreCircle(circularity, corners),
      triangle: scoreTriangle(corners, fill),
      square: scoreSquare(corners, aspect, fill),
    };

    let bestLabel = 'circle';
    let bestScore = -Infinity;
    for (const [label, s] of Object.entries(scores)) {
      if (s > bestScore) {
        bestScore = s;
        bestLabel = label;
      }
    }

    return {
      label: bestLabel,
      confidence: clamp01(bestScore),
      scores,
    };
  } finally {
    src.delete();
    gray.delete();
    binary.delete();
    contours.delete();
    hierarchy.delete();
    approx.delete();
  }
}

function scoreCircle(circularity, corners) {
  const cornerPenalty = corners <= 5 ? (5 - corners) * 0.15 : 0;
  return clamp01(circularity - cornerPenalty);
}
function scoreTriangle(corners, fill) {
  if (corners < 3) return 0;
  const cornerFit = corners === 3 ? 1 : Math.max(0, 1 - (corners - 3) * 0.25);
  const fillFit = 1 - Math.abs(fill - 0.5) * 1.5;
  return clamp01(0.65 * cornerFit + 0.35 * Math.max(0, fillFit));
}
function scoreSquare(corners, aspect, fill) {
  if (corners < 4) return 0;
  const cornerFit = corners === 4 ? 1 : Math.max(0, 1 - (corners - 4) * 0.2);
  const fillFit = clamp01(fill / 0.9);
  return clamp01(0.4 * cornerFit + 0.3 * aspect + 0.3 * fillFit);
}
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
