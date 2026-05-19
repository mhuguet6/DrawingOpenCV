import { useCallback, useEffect, useRef, useState } from 'react';

import DrawingCanvas from './components/DrawingCanvas.jsx';
import WebcamCapture from './components/WebcamCapture.jsx';
import PredictionPanel from './components/PredictionPanel.jsx';
import HowItWorks from './components/HowItWorks.jsx';

import { ensureCv, onCvSource } from './cv/cvClient.js';
import { classifyShape } from './cv/shapeClassifier.js';
import { speak, isSpeechSupported } from './utils/speech.js';

/**
 * Top-level state container. Intentionally minimal: one view toggle, an
 * OpenCV ready/loading flag pair, and the latest shape prediction.
 *
 * Boot kicks off OpenCV in a Web Worker — the WASM compile happens on the
 * worker thread so the page is interactive throughout. If the user clicks
 * Classify before the worker is ready, runClassification awaits the same
 * memoized init Promise.
 */
export default function App() {
  const [view, setView] = useState('draw'); // 'draw' | 'about'
  const [inputMode, setInputMode] = useState('canvas'); // 'canvas' | 'webcam'
  const [cvReady, setCvReady] = useState(false);
  const [cvLoading, setCvLoading] = useState(true);
  const [cvError, setCvError] = useState(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [autoClassify, setAutoClassify] = useState(true);
  const [prediction, setPrediction] = useState(null);
  // 'idle'      — nothing classified yet (initial / after reset)
  // 'no-shape'  — classifier ran but couldn't find a clear shape
  // 'error'     — worker threw / OpenCV failed / etc.
  // 'success'   — see `prediction`
  const [classifyStatus, setClassifyStatus] = useState('idle');
  const [classifyError, setClassifyError] = useState(null);
  // Diagnostic counters. Surfaced in the prediction panel so we can see
  // exactly where the pipeline breaks if predictions don't appear.
  const [strokeEndCount, setStrokeEndCount] = useState(0);
  const [classifyCount, setClassifyCount] = useState(0);
  // Elapsed wall-clock since boot. Drives the "Loading OpenCV (Xs)…"
  // counter so the user can see something is actually happening.
  const [elapsed, setElapsed] = useState(0);
  // Which OpenCV.js the worker actually loaded — local minimal build or
  // the CDN fallback. The worker sends a `cv-source` notification once
  // it picks one. Shown in the loading card so the user can confirm
  // build-opencv.sh actually worked.
  const [cvSource, setCvSource] = useState(null);

  const surfaceRef = useRef(null);
  const lastSpokenRef = useRef('');

  // Kick off OpenCV in the worker immediately. Safe to do eagerly — the
  // compile runs off-main-thread, so the page stays interactive.
  useEffect(() => {
    let cancelled = false;
    const startedAt = performance.now();
    ensureCv()
      .then(() => { if (!cancelled) { setCvReady(true); setCvLoading(false); } })
      .catch((err) => { if (!cancelled) { setCvError(err.message); setCvLoading(false); } });
    // Tick the elapsed counter once per second while we wait for OpenCV.
    const interval = setInterval(() => {
      if (cancelled) return;
      setElapsed(Math.round((performance.now() - startedAt) / 1000));
    }, 250);
    const unsubscribe = onCvSource((url) => {
      if (!cancelled) setCvSource(url);
    });
    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const runClassification = useCallback(async () => {
    setClassifyCount((c) => c + 1);
    const surface = surfaceRef.current;
    if (!surface) return;
    const canvas = surface.getCanvas();
    if (!canvas) return;
    try {
      await ensureCv(); // resolves instantly if worker has already booted
      const result = await classifyShape(canvas);
      if (result) {
        setPrediction(result);
        setClassifyStatus('success');
        setClassifyError(null);
        if (voiceOn) {
          const text = `This is a ${result.label}`;
          if (text !== lastSpokenRef.current) {
            lastSpokenRef.current = text;
            speak(text);
          }
        }
      } else {
        setPrediction(null);
        setClassifyStatus('no-shape');
        setClassifyError(null);
      }
    } catch (err) {
      // Unhandled here would become an unhandled-rejection in DevTools and
      // leave the user staring at an empty panel. Surface it instead.
      console.error('Classification failed:', err);
      setPrediction(null);
      setClassifyStatus('error');
      setClassifyError(err?.message ?? String(err));
    }
  }, [voiceOn]);

  const handleStrokeEnd = useCallback(() => {
    setStrokeEndCount((c) => c + 1);
    if (autoClassify) runClassification();
  }, [autoClassify, runClassification]);

  const handleReset = useCallback(() => {
    surfaceRef.current?.clear();
    setPrediction(null);
    setClassifyStatus('idle');
    setClassifyError(null);
    lastSpokenRef.current = '';
  }, []);

  const statusClass =
    cvError ? 'status error' : cvReady ? 'status ready' : 'status';
  const statusText =
    cvError ? `⚠ ${cvError}`
      : cvReady ? 'OpenCV ready'
      : 'Loading OpenCV (in background)…';

  return (
    <div className="app">
      <header className="header">
        <h1>Air Drawing <span>·</span> Shape Recognizer</h1>
        <div className={statusClass}>{statusText}</div>
      </header>

      <main className="workspace">
        <section className="card">
          <div className="tabs">
            {view === 'draw' && (
              <>
                <button
                  className={inputMode === 'canvas' ? 'active' : ''}
                  onClick={() => { setInputMode('canvas'); handleReset(); }}
                >
                  ✍ Canvas
                </button>
                <button
                  className={inputMode === 'webcam' ? 'active' : ''}
                  onClick={() => { setInputMode('webcam'); handleReset(); }}
                >
                  📷 Webcam (Air)
                </button>
                <div style={{ flex: 1 }} />
              </>
            )}
            <button
              className={view === 'about' ? 'active' : ''}
              onClick={() => setView('about')}
            >
              ℹ How it works
            </button>
            {view === 'about' && (
              <button onClick={() => setView('draw')}>← Back to draw</button>
            )}
          </div>

          {view === 'about' ? (
            <HowItWorks />
          ) : (
            <>
              <div className="stage">
                {inputMode === 'canvas'
                  ? <DrawingCanvas ref={surfaceRef} onStrokeEnd={handleStrokeEnd} />
                  : <WebcamCapture ref={surfaceRef} onStrokeEnd={handleStrokeEnd} />}
                {/* No overlay — OpenCV loads in a worker, so the main
                    thread (and this stage) stay fully responsive while it
                    initializes. The status text in the header is the only
                    indicator. */}
              </div>

              <div className="controls">
                <button
                  className="primary"
                  onClick={runClassification}
                  title={!cvReady ? 'OpenCV still loading — your click will queue and fire when ready.' : ''}
                >
                  Classify
                </button>
                <button onClick={handleReset}>Reset</button>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={autoClassify}
                    onChange={(e) => setAutoClassify(e.target.checked)}
                  />
                  Auto-classify on stroke end
                </label>
                <label
                  className="toggle"
                  title={isSpeechSupported() ? '' : 'Speech synthesis not supported in this browser'}
                >
                  <input
                    type="checkbox"
                    checked={voiceOn}
                    onChange={(e) => setVoiceOn(e.target.checked)}
                    disabled={!isSpeechSupported()}
                  />
                  🔊 Speak result
                </label>
              </div>

              <div className="hint">
                {inputMode === 'canvas'
                  ? 'Draw one closed shape — circle, square, or triangle — with your mouse, finger, or stylus. Auto-classify fires when you lift the pointer.'
                  : 'Pinch your thumb and index finger together to draw; pull them apart to lift the pen.'}
              </div>
            </>
          )}
        </section>

        <aside className="card">
          {view === 'about' ? (
            <>
              <h2>At a glance</h2>
              <div className="about-summary">
                <div className="about-row"><span>Frontend</span><strong>React 18 + Vite 5</strong></div>
                <div className="about-row"><span>Computer vision</span><strong>OpenCV.js 4.10</strong></div>
                <div className="about-row"><span>Hand tracking</span><strong>MediaPipe HandLandmarker</strong></div>
                <div className="about-row"><span>Shape logic</span><strong>cv.findContours + approxPolyDP</strong></div>
                <div className="about-row"><span>Voice</span><strong>Web Speech API</strong></div>
              </div>
            </>
          ) : (
            <>
              <h2>Shape</h2>
              <PredictionPanel
                prediction={prediction}
                status={classifyStatus}
                error={classifyError}
                cvReady={cvReady}
                cvLoading={cvLoading}
                elapsed={elapsed}
                cvSource={cvSource}
                diagnostics={{
                  cvReady,
                  cvLoading,
                  cvSource,
                  strokeEndCount,
                  classifyCount,
                }}
              />
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
