/**
 * Main-thread client for the OpenCV worker.
 *
 * The worker compiles OpenCV's ~8 MB WASM on its own thread so the page
 * never freezes. Here we just orchestrate request/response correlation.
 *
 * Public API:
 *   ensureCv()                       → Promise<true>   when OpenCV is ready
 *   classifyShape(width, h, buffer)  → Promise<result> (buffer is transferred)
 */

let worker = null;
let initPromise = null;
let nextId = 0;
const pending = new Map();
let cvSourceUrl = null;            // populated by the worker on init
const sourceListeners = new Set();

/**
 * Subscribe to "the worker chose this OpenCV source" notifications.
 * Returns an unsubscribe function. Replays the current value immediately
 * if one is already known.
 */
export function onCvSource(callback) {
  if (cvSourceUrl) callback(cvSourceUrl);
  sourceListeners.add(callback);
  return () => sourceListeners.delete(callback);
}

function getWorker() {
  if (worker) return worker;
  // Vite recognizes this exact pattern and bundles the worker as a
  // separate chunk. We rely on the default classic worker type so the
  // worker can use `importScripts()` to load OpenCV.js from the CDN.
  worker = new Worker(new URL('./cvWorker.js', import.meta.url));
  worker.addEventListener('message', (e) => {
    const msg = e.data ?? {};
    // Side-channel: the worker notifies us once which OpenCV source it
    // ended up using (local minimal build vs CDN fallback).
    if (msg.kind === 'cv-source' && msg.url) {
      cvSourceUrl = msg.url;
      sourceListeners.forEach((cb) => cb(msg.url));
      return;
    }
    const { id, result, error } = msg;
    if (id === undefined) return;
    const handlers = pending.get(id);
    if (!handlers) return;
    pending.delete(id);
    if (error !== undefined) handlers.reject(new Error(error));
    else handlers.resolve(result);
  });
  worker.addEventListener('error', (e) => {
    // Reject every in-flight request so callers don't hang.
    const err = new Error(e.message || 'OpenCV worker crashed.');
    pending.forEach(({ reject }) => reject(err));
    pending.clear();
    initPromise = null;
  });
  return worker;
}

function rpc(type, payload, transferables = []) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, payload }, transferables);
  });
}

/**
 * Triggers OpenCV load inside the worker if it hasn't started yet, and
 * resolves once `cv.Mat` is available. Safe to call repeatedly — the
 * Promise is memoized.
 */
export function ensureCv() {
  if (initPromise) return initPromise;
  initPromise = rpc('init').catch((e) => {
    initPromise = null; // allow retry on failure
    throw e;
  });
  return initPromise;
}

/**
 * Classify a rasterized stroke. `buffer` is the Uint8ClampedArray.buffer
 * from an ImageData and is **transferred** to the worker — callers must
 * not use it after this call returns.
 */
export function classifyShape(width, height, buffer) {
  return rpc('classify-shape', { width, height, buffer }, [buffer]);
}
