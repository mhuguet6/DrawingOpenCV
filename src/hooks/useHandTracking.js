/**
 * Lazy-load MediaPipe Hands and run per-frame detection on a <video>.
 *
 * - Returns a stable `start(video)` / `stop()` API and a `landmarksRef` that
 *   the consumer can poll inside its own rAF loop (cheaper than React state
 *   updates at 30-60 fps).
 * - The "draw gesture" is a thumb-index pinch: when landmark 4 (thumb tip)
 *   and 8 (index tip) are within ~7% of the video width of each other, we
 *   emit a "drawing" stroke point at the index tip. Releasing the pinch ends
 *   the stroke.
 * - WASM bundle and model are loaded from jsdelivr / Google CDN on demand,
 *   so the cost is only paid when the user actually switches to webcam mode.
 */
import { useEffect, useRef } from 'react';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const PINCH_THRESHOLD = 0.07; // fraction of frame size

export function useHandTracking({ onPoint, onPinchEnd } = {}) {
  const landmarkerRef = useRef(null);
  const rafRef = useRef(0);
  const videoRef = useRef(null);
  const pinchingRef = useRef(false);
  const lastTsRef = useRef(0);
  const callbacks = useRef({ onPoint, onPinchEnd });
  callbacks.current = { onPoint, onPinchEnd };

  async function ensureLandmarker() {
    if (landmarkerRef.current) return landmarkerRef.current;
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      numHands: 1,
      runningMode: 'VIDEO',
    });
    landmarkerRef.current = landmarker;
    return landmarker;
  }

  function tick() {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker) return;

    // detectForVideo requires a monotonically increasing timestamp.
    let ts = performance.now();
    if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
    lastTsRef.current = ts;

    if (video.readyState >= 2) {
      const result = landmarker.detectForVideo(video, ts);
      const hand = result?.landmarks?.[0];
      if (hand) {
        const thumb = hand[4];
        const index = hand[8];
        const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
        const isPinching = dist < PINCH_THRESHOLD;
        if (isPinching) {
          // Coordinates are normalized [0,1] with origin at top-left, X mirrored
          // to match the on-screen "selfie" view of the video.
          callbacks.current.onPoint?.({
            x: 1 - index.x,
            y: index.y,
            pinch: true,
          });
          pinchingRef.current = true;
        } else if (pinchingRef.current) {
          pinchingRef.current = false;
          callbacks.current.onPinchEnd?.();
        }
      } else if (pinchingRef.current) {
        pinchingRef.current = false;
        callbacks.current.onPinchEnd?.();
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  async function start(video) {
    videoRef.current = video;
    await ensureLandmarker();
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    videoRef.current = null;
    pinchingRef.current = false;
  }

  useEffect(() => () => {
    stop();
    landmarkerRef.current?.close?.();
    landmarkerRef.current = null;
  }, []);

  return { start, stop };
}
