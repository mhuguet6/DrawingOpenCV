/**
 * Pure-display panel for the latest shape classification.
 *
 * Props:
 *   - prediction: { label, confidence, scores } | null
 *   - status: 'idle' | 'no-shape' | 'error' | 'success'
 *   - error: string | null  (only meaningful when status === 'error')
 *   - diagnostics: { cvReady, cvLoading, strokeEndCount, classifyCount }
 */
export default function PredictionPanel({
  prediction,
  status = 'idle',
  error = null,
  cvReady = true,
  cvLoading = false,
  elapsed = 0,
  cvSource = null,
  diagnostics = null,
}) {
  const sourceLabel = describeSource(cvSource);
  const diag = diagnostics && (
    <div className="diagnostics">
      <div className="diag-row">
        <span>OpenCV</span>
        <strong>
          {diagnostics.cvReady ? 'ready'
            : diagnostics.cvLoading ? 'loading…'
            : 'idle'}
        </strong>
      </div>
      {sourceLabel && (
        <div className="diag-row">
          <span>Source</span>
          <strong style={{ color: cvSource?.startsWith('/') ? 'var(--accent-2)' : 'var(--muted)' }}>
            {sourceLabel}
          </strong>
        </div>
      )}
      <div className="diag-row">
        <span>Stroke-end events</span>
        <strong>{diagnostics.strokeEndCount}</strong>
      </div>
      <div className="diag-row">
        <span>Classify attempts</span>
        <strong>{diagnostics.classifyCount}</strong>
      </div>
    </div>
  );

  // Show the loading state as the FIRST priority — if OpenCV isn't ready
  // yet, classification literally cannot run, and we don't want the user
  // to interpret the empty "Draw something to start" message as a failure.
  // Calls to runClassification during this window are queued (they await
  // the same shared ensureCv() promise) and will fire automatically as
  // soon as the worker reports ready.
  if (cvLoading || (!cvReady && status === 'idle')) {
    const queued = diagnostics ? diagnostics.classifyCount : 0;
    const usingLocal = cvSource && cvSource.startsWith('/');
    return (
      <div className="prediction">
        <div className="loading-card">
          <div className="loading-spinner" />
          <div className="loading-title">Loading OpenCV…</div>
          <div className="loading-elapsed">{elapsed}s elapsed</div>
          <div className="loading-hint">
            {usingLocal
              ? <>Compiling your local minimal build (~1.5–2&nbsp;MB) on a worker thread. Should take ~1&nbsp;s.</>
              : cvSource
              ? <>Compiling the 8&nbsp;MB CDN build on a worker thread. Run <code>./scripts/build-opencv.sh</code> once to switch to a minimal build (~1&nbsp;s compile).</>
              : <>Choosing OpenCV source…</>}
            {queued > 0 && (
              <>
                <br/><br/>
                <strong style={{ color: 'var(--accent-2)' }}>
                  {queued} classification{queued > 1 ? 's' : ''} queued
                </strong>{' '}
                — will fire automatically when OpenCV is ready.
              </>
            )}
          </div>
        </div>
        {diag}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="prediction">
        <div>
          <div className="label" style={{ color: 'var(--bad)' }}>Classification failed</div>
          <div className="error-card">
            ⚠ {error || 'Unknown error.'}
          </div>
          <div className="label" style={{ marginTop: 12, lineHeight: 1.5 }}>
            Check the browser console (DevTools → Console) for the full stack
            trace. Most common causes: OpenCV CDN blocked, worker failed to
            spawn, browser blocked cross-origin imports.
          </div>
        </div>
        {diag}
      </div>
    );
  }

  if (status === 'no-shape') {
    return (
      <div className="prediction">
        <div>
          <div className="label">No clear shape detected</div>
          <div className="big empty" style={{ fontSize: 16, lineHeight: 1.4 }}>
            Try drawing a clearer<br/>closed shape.
          </div>
          <div className="label" style={{ marginTop: 8, lineHeight: 1.5 }}>
            Make sure the shape is closed (start and end points meet) and large
            enough to see clearly. Press Reset to start over.
          </div>
        </div>
        {diag}
      </div>
    );
  }

  // idle or success
  const bars = prediction
    ? Object.entries(prediction.scores)
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({
          label: label[0].toUpperCase() + label.slice(1),
          value,
        }))
    : [];

  return (
    <div className="prediction">
      <div>
        <div className="label">Prediction</div>
        <div className={`big ${prediction ? '' : 'empty'}`}>
          {prediction
            ? prediction.label[0].toUpperCase() + prediction.label.slice(1)
            : 'Draw something to start'}
        </div>
        {prediction && (
          <div className="label">
            Confidence&nbsp;
            <strong style={{ color: 'var(--text)' }}>
              {(prediction.confidence * 100).toFixed(1)}%
            </strong>
          </div>
        )}
      </div>

      {bars.length > 0 && (
        <div>
          <div className="label" style={{ marginBottom: 8 }}>Scores</div>
          <div className="bars">
            {bars.map(({ label, value }) => (
              <div className="bar" key={label}>
                <span>{label}</span>
                <div className="track">
                  <div className="fill" style={{ width: `${value * 100}%` }} />
                </div>
                <span className="pct">{(value * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {diag}
    </div>
  );
}

function describeSource(url) {
  if (!url) return null;
  if (url.startsWith('/')) return 'local minimal build';
  try {
    return new URL(url).host;
  } catch {
    return 'CDN';
  }
}
