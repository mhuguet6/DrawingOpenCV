import { useEffect, useImperativeHandle, useRef, useState, forwardRef, useCallback } from 'react';
import { useHandTracking } from '../hooks/useHandTracking.js';
import { renderStrokes } from '../utils/canvasUtils.js';

/**
 * Webcam-based "air drawing" surface.
 *
 *   <video>  →  shows mirrored camera feed
 *   <canvas> →  overlay where we render the user's strokes (white on transparent)
 *
 * The user pinches thumb to index to draw, and releases to lift the pen.
 * Behind the scenes we feed each video frame into MediaPipe Hands (via the
 * `useHandTracking` hook) and route detected fingertip positions into the
 * stroke buffer that lives in this component.
 *
 * The component also exposes an offscreen "rasterized" canvas (white on black
 * MNIST-style) so the parent can hand it to the digit classifier directly.
 */
const WebcamCapture = forwardRef(function WebcamCapture(
  { onStrokeEnd, lineWidth = 18 },
  ref,
) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);   // user-visible white-on-transparent
  const exportRef = useRef(null);    // offscreen white-on-black (MNIST style)
  const strokesRef = useRef([]);
  const currentStrokeRef = useRef(null);
  const [status, setStatus] = useState('Requesting camera…');
  const [error, setError] = useState(null);

  const redraw = useCallback(() => {
    const overlay = overlayRef.current;
    const exp = exportRef.current;
    if (!overlay || !exp) return;
    // Visible overlay: subtle glow, leave background transparent.
    const octx = overlay.getContext('2d');
    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.save();
    octx.shadowColor = '#7c9cff';
    octx.shadowBlur = 12;
    renderStrokes(
      overlay,
      strokesRef.current,
      currentStrokeRef.current,
      { lineWidth, background: 'rgba(0,0,0,0)', color: '#7c9cff' },
    );
    octx.restore();
    // Export canvas: MNIST-compatible.
    renderStrokes(
      exp,
      strokesRef.current,
      currentStrokeRef.current,
      { lineWidth, background: '#000', color: '#fff' },
    );
  }, [lineWidth]);

  const { start: startTracking, stop: stopTracking } = useHandTracking({
    onPoint: ({ x, y }) => {
      const cvs = overlayRef.current;
      if (!cvs) return;
      const pt = { x: x * cvs.width, y: y * cvs.height };
      if (!currentStrokeRef.current) currentStrokeRef.current = [];
      currentStrokeRef.current.push(pt);
      redraw();
    },
    onPinchEnd: () => {
      const stroke = currentStrokeRef.current;
      if (stroke && stroke.length > 0) {
        strokesRef.current = [...strokesRef.current, stroke];
        currentStrokeRef.current = null;
        redraw();
        onStrokeEnd?.(stroke, strokesRef.current);
      } else {
        currentStrokeRef.current = null;
      }
    },
  });

  useImperativeHandle(ref, () => ({
    // Parent reads this canvas for digit classification.
    getCanvas: () => exportRef.current,
    getStrokes: () => strokesRef.current,
    getLastStroke: () =>
      strokesRef.current.length ? strokesRef.current[strokesRef.current.length - 1] : null,
    clear: () => {
      strokesRef.current = [];
      currentStrokeRef.current = null;
      redraw();
    },
  }), [redraw]);

  // Bring up the camera once on mount; tear it down on unmount.
  useEffect(() => {
    let stream;
    let cancelled = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        sizeCanvases();
        setStatus('Loading hand tracker…');
        await startTracking(video);
        setStatus('Pinch thumb + index to draw');
      } catch (err) {
        setError(err?.message ?? 'Camera unavailable.');
        setStatus(null);
      }
    })();

    function sizeCanvases() {
      const video = videoRef.current;
      const overlay = overlayRef.current;
      const exp = exportRef.current;
      if (!video || !overlay || !exp) return;
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      overlay.width = w;
      overlay.height = h;
      exp.width = w;
      exp.height = h;
      redraw();
    }

    return () => {
      cancelled = true;
      stopTracking();
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <video ref={videoRef} playsInline muted />
      <canvas ref={overlayRef} />
      {/* Off-DOM canvas used for export to the classifier — display:none keeps it out of layout. */}
      <canvas ref={exportRef} style={{ display: 'none' }} />
      {(status || error) && (
        <div className="toast">
          {error ? `Camera error: ${error}` : status}
        </div>
      )}
    </>
  );
});

export default WebcamCapture;
