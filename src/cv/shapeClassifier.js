/**
 * Shape classifier (main-thread entry point).
 *
 * All the OpenCV work happens inside the worker — see ./cvWorker.js.
 * This file just reads pixels off the canvas, transfers the buffer to
 * the worker, and awaits the verdict.
 *
 * `ctx.getImageData()` allocates a fresh Uint8ClampedArray every call,
 * so transferring its buffer doesn't affect anything else (the canvas
 * itself is untouched).
 */
import { classifyShape as classifyShapeInWorker } from './cvClient.js';

/**
 * @param {HTMLCanvasElement} canvas - white strokes on black background
 * @returns {Promise<{ label: string, confidence: number, scores: Record<string, number> } | null>}
 */
export async function classifyShape(canvas) {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return classifyShapeInWorker(canvas.width, canvas.height, imageData.data.buffer);
}
