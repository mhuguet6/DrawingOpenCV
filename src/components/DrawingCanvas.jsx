import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import { renderStrokes } from '../utils/canvasUtils.js';

/**
 * Mouse / touch / stylus drawing surface.
 *
 * Exposes the same imperative ref API that WebcamCapture does
 * ({ getCanvas, getStrokes, getLastStroke, clear }) so App.jsx's
 * classification code doesn't need to branch on which input is active.
 * White strokes on black background — matches what the OpenCV worker
 * expects (it just thresholds the channel).
 *
 * Pointer Events cover mouse, touch and stylus with one code path.
 */
const DrawingCanvas = forwardRef(function DrawingCanvas(
  { onStrokeEnd, lineWidth = 22 },
  ref,
) {
  const canvasRef = useRef(null);
  const strokesRef = useRef([]);          // committed strokes
  const currentStrokeRef = useRef(null);  // stroke currently being drawn
  const drawingRef = useRef(false);

  const redraw = useCallback(() => {
    renderStrokes(
      canvasRef.current,
      strokesRef.current,
      currentStrokeRef.current,
      { lineWidth },
    );
  }, [lineWidth]);

  // Resize the canvas backing store to match its CSS box (1:1, DPR-aware).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      redraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    getStrokes: () => strokesRef.current,
    getLastStroke: () =>
      strokesRef.current.length
        ? strokesRef.current[strokesRef.current.length - 1]
        : null,
    clear: () => {
      strokesRef.current = [];
      currentStrokeRef.current = null;
      redraw();
    },
  }), [redraw]);

  function pointFromEvent(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function handlePointerDown(e) {
    e.target.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    currentStrokeRef.current = [pointFromEvent(e)];
    redraw();
  }
  function handlePointerMove(e) {
    if (!drawingRef.current) return;
    currentStrokeRef.current.push(pointFromEvent(e));
    redraw();
  }
  function handlePointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const stroke = currentStrokeRef.current ?? [];
    currentStrokeRef.current = null;
    if (stroke.length > 0) {
      strokesRef.current = [...strokesRef.current, stroke];
      redraw();
      onStrokeEnd?.(stroke, strokesRef.current);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="draw"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
    />
  );
});

export default DrawingCanvas;
