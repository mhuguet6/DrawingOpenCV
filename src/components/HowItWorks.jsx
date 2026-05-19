/**
 * Static explainer view for the "How it works" tab.
 *
 * Pure presentation — no state, no side effects, no props.
 */
export default function HowItWorks() {
  return (
    <div className="explainer">
      <header className="explainer-hero">
        <h3>From a finger trace to a shape</h3>
        <p>
          You pinch in front of the camera, your finger traces a polygon, and
          OpenCV decides whether it's a circle, square, or triangle. The whole
          pipeline runs in the browser — no server, no upload, no API.
        </p>
      </header>

      <div className="pipeline">
        <PipelineStep
          n="1"
          title="Capture"
          stack="MediaPipe HandLandmarker"
          body="Each video frame goes through MediaPipe's hand model, which returns 21 landmarks per detected hand. We watch landmark 4 (thumb tip) and 8 (index tip). When they pinch together (distance < 7% of the frame), we start recording the index tip's position as a stroke. Release the pinch and the stroke ends."
        />
        <Arrow />
        <PipelineStep
          n="2"
          title="Rasterize"
          stack="Canvas 2D"
          body="The stroke is painted to an offscreen canvas as a thick white line on a black background. This rasterized image is what OpenCV will read — strokes get a uniform width regardless of how fast you moved, which gives the contour finder a clean shape to work with."
        />
        <Arrow />
        <PipelineStep
          n="3"
          title="Detect"
          stack="OpenCV.js"
          body="cv.imread → cvtColor(GRAY) → threshold → findContours (RETR_EXTERNAL). Pick the largest contour, compute its perimeter (arcLength) and area (contourArea), then simplify with approxPolyDP at ε = 4% of the perimeter. The remaining vertex count, the circularity ratio 4πA / P², and the bounding-box aspect/fill are fed into a small scoring function."
        />
        <Arrow />
        <PipelineStep
          n="4"
          title="Decide"
          stack="Heuristic + Web Speech"
          body="Three candidate scores: circle (rewards high circularity, penalizes few corners), triangle (exactly 3 corners, ~50% bbox fill), square (4 corners, square-ish aspect, high bbox fill). Highest score wins. With voice enabled, SpeechSynthesis announces the result."
        />
      </div>

      <section className="explainer-section">
        <h4>Where OpenCV is doing the work</h4>
        <p>
          OpenCV.js runs inside a <strong>Web Worker</strong>. The ~8&nbsp;MB
          WebAssembly module compiles on its own thread, so the main thread —
          and this page — stays fully responsive while it loads. The main
          thread sends the canvas pixels as a transferable
          <code>ImageData</code> buffer (zero-copy) and awaits the result over
          <code>postMessage</code>. All Mats are explicitly
          <code>.delete()</code>'d in <code>finally</code> blocks; the
          JavaScript GC can't free emscripten-heap objects.
        </p>
        <table className="stack-table">
          <thead>
            <tr><th>OpenCV API</th><th>Used for</th></tr>
          </thead>
          <tbody>
            <tr><td><code>cv.imread</code></td><td>Read the rasterized stroke canvas into a Mat</td></tr>
            <tr><td><code>cv.cvtColor</code></td><td>RGBA → grayscale</td></tr>
            <tr><td><code>cv.threshold</code></td><td>Binary mask of the ink</td></tr>
            <tr><td><code>cv.findContours</code></td><td>Extract the shape outline</td></tr>
            <tr><td><code>cv.contourArea</code> / <code>cv.arcLength</code></td><td>Circularity = 4πA / P²</td></tr>
            <tr><td><code>cv.approxPolyDP</code></td><td>Count corners at ε = 4% of perimeter</td></tr>
            <tr><td><code>cv.boundingRect</code></td><td>Aspect ratio + bbox fill for square scoring</td></tr>
          </tbody>
        </table>
      </section>

      <section className="explainer-section">
        <h4>Tech stack</h4>
        <div className="stack-grid">
          <StackItem label="UI" value="React 18 + Vite 5" />
          <StackItem label="Computer vision" value="OpenCV.js 4.10 (lazy-loaded from CDN)" />
          <StackItem label="Hand tracking" value="MediaPipe Tasks Vision · HandLandmarker" />
          <StackItem label="Voice" value="Web Speech API (built-in)" />
        </div>
      </section>
    </div>
  );
}

function PipelineStep({ n, title, stack, body }) {
  return (
    <div className="step">
      <div className="step-head">
        <span className="step-num">{n}</span>
        <div>
          <div className="step-title">{title}</div>
          <div className="step-stack">{stack}</div>
        </div>
      </div>
      <p className="step-body">{body}</p>
    </div>
  );
}

function Arrow() {
  return <div className="step-arrow" aria-hidden="true">→</div>;
}

function StackItem({ label, value }) {
  return (
    <div className="stack-item">
      <div className="stack-label">{label}</div>
      <div className="stack-value">{value}</div>
    </div>
  );
}
