# CLAUDE.md — Project Context

> **Purpose of this file:** Persistent context for Claude in future sessions.
> Read this first before reading any source. It documents *intent* and *the
> reasoning behind every design choice*, which is the stuff that's hard or
> impossible to recover from the code alone.

---

## 1. What this project is (current scope)

A **browser-only web application** that recognises **basic shapes —
circle, square, triangle — drawn in the air** in front of a webcam using a
thumb-index pinch gesture.

Everything runs locally in the browser. **No backend, no APIs, no telemetry.**

The project went through a deliberate simplification pass: it used to also
support a canvas drawing surface and digit (0–9) recognition with an
in-browser TFJS CNN. **Both were removed** because TFJS + first-run MNIST
training + OpenCV all loading in parallel made the page unresponsive at
boot. The simpler scope here loads in ~50 KB gzip, is interactive
immediately, and only does heavy work (OpenCV WASM compile) on explicit
user intent.

**If a future session is tempted to re-add canvas drawing or digit
recognition: don't, unless the user explicitly asks.** The simplification
was the user's call, made for a reason.

---

## 2. Tech stack

### Runtime dependencies (3)

| Package | Version | Role |
|---|---|---|
| `react` | ^18.3.1 | UI framework |
| `react-dom` | ^18.3.1 | DOM renderer |
| `@mediapipe/tasks-vision` | ^0.10.14 | `HandLandmarker` for air-drawing |

**OpenCV.js is NOT an npm dependency.** It's loaded at runtime inside a
Web Worker via `importScripts()`. The worker checks for a locally-built
minimal version at `/opencv-min.js` first and falls back to the official
CDN (`https://docs.opencv.org/4.10.0/opencv.js`) if absent.

To build the minimal version locally (cuts load time from 3-5 s to ~1 s):
```
./scripts/build-opencv.sh
```
This uses Docker to run emscripten — see the script header for details.
Output goes to `public/opencv-min.js` + `public/opencv_js.wasm` (both
gitignored).

**Quick alternative without Docker**: download the official single-file
build into `public/opencv-min.js`:
```
curl -fL --progress-bar -o public/opencv-min.js \
  https://docs.opencv.org/4.10.0/opencv.js
```
This is ~10 MB instead of ~2 MB and the WASM compile is slower (~15-25 s
vs ~1 s), but it eliminates the slow network round-trip to
docs.opencv.org and works without Docker. The worker auto-detects it
because of the content-type check in `isLocalBuildAvailable()`. Do NOT
attempt to manually split this file's embedded base64 WASM into a
separate `.wasm` file to get streaming compile — multiple internal code
paths in emscripten's runtime depend on the inline data URL in
non-obvious ways, and patching it has broken initialization every time
it's been tried. Either accept the ~25 s cost or run the Docker build.

### Build dependencies (2)

| Package | Version | Role |
|---|---|---|
| `vite` | ^5.4.10 | dev server + production bundler |
| `@vitejs/plugin-react` | ^4.3.4 | JSX transform |

### Loaded at runtime (not via npm)

| Resource | Source | When |
|---|---|---|
| OpenCV.js 4.10 WASM (~8 MB) | `docs.opencv.org/4.10.0/opencv.js` | Lazy — first Classify click only |
| MediaPipe Hands WASM + model (~3 MB) | jsdelivr + Google Storage | Lazy — when the webcam stream initializes |

### Bundle size (post-simplification)

```
dist/index.html                       0.5 kB  (0.3 kB gzip)
dist/assets/index-*.css               7.2 kB  (2.1 kB gzip)
dist/assets/vision_bundle-*.js      125.6 kB  (38.3 kB gzip)   ← MediaPipe, lazy-imported
dist/assets/index-*.js              159.4 kB  (52.1 kB gzip)   ← React + app code
```

Total initial paint: ~52 KB gzip. The MediaPipe chunk is code-split because
`useHandTracking.js` uses `await import('@mediapipe/tasks-vision')`.

---

## 3. Project structure

```
.
├── README.md
├── CLAUDE.md                  This file (Claude context)
├── package.json
├── vite.config.js
├── index.html
└── src/
    ├── main.jsx               React entry point — renders <App/>
    ├── App.jsx                Top-level state container (small, flat)
    │
    ├── styles/
    │   └── index.css          ALL styling (single file, no CSS modules)
    │
    ├── components/
    │   ├── WebcamCapture.jsx      Webcam + pinch-to-draw overlay (the only input surface)
    │   ├── PredictionPanel.jsx    Big-label + confidence + score bars
    │   └── HowItWorks.jsx         Static explainer view ("ℹ How it works" tab)
    │
    ├── hooks/
    │   └── useHandTracking.js     Lazy-loads MediaPipe; emits fingertip events on pinch
    │
    ├── cv/
    │   ├── cvWorker.js            Web Worker that hosts OpenCV.js + the shape pipeline
    │   ├── cvClient.js            Main-thread RPC wrapper around the worker
    │   └── shapeClassifier.js     Thin main-thread shim: reads ImageData, forwards to worker
    │
    └── utils/
        ├── canvasUtils.js         Shared renderStrokes() helper used by WebcamCapture
        └── speech.js              Thin SpeechSynthesis wrapper
```

**There is no `src/ml/` directory.** TensorFlow.js was removed. If you find
yourself looking for `modelLoader.js`, `preprocess.js`, or `mnistData.js`,
they no longer exist.

### File-by-file responsibility map

- **`src/App.jsx`** is the only stateful glue layer. State:
  - `view` (`'draw' | 'about'`)
  - `cvReady`, `cvLoading`, `cvError` — OpenCV lifecycle flags
  - `voiceOn`, `autoClassify`
  - `prediction`
  - `surfaceRef` → the `WebcamCapture` imperative ref
  - `lastSpokenRef` → de-duplicates voice announcements

  Exposes `ensureCv()` which lazy-loads OpenCV (sets `cvLoading`, yields
  one rAF tick so the overlay paints, awaits `getCv()`).

- **`src/components/WebcamCapture.jsx`** mounts a `<video>` (mirrored
  camera feed) plus two `<canvas>` overlays: one visible (`overlayRef`,
  glow effect for what the user sees) and one offscreen (`exportRef`,
  plain white-on-black for OpenCV). Exposes via `useImperativeHandle`:
  `{ getCanvas, getStrokes, getLastStroke, clear }`. **This is the only
  drawing surface.** `getCanvas()` returns the export canvas.

- **`src/hooks/useHandTracking.js`** lazy-imports
  `@mediapipe/tasks-vision`, creates a `HandLandmarker` (GPU delegate),
  runs a `requestAnimationFrame` loop. Pinch threshold: distance between
  landmark 4 (thumb tip) and 8 (index tip) < 7 % of frame size.
  Everything stored in refs (not React state) to avoid 60 fps re-renders.

- **`src/cv/cvWorker.js`** — runs on a Web Worker thread. Loads OpenCV.js
  via `importScripts()` (synchronous within the worker, but invisible to
  the main thread). All OpenCV pipeline code lives here. Communicates with
  the main thread via id-based RPC: `{ id, type, payload }` in, `{ id,
  result | error }` out. **Every `cv.Mat`, `cv.MatVector`, etc. is
  explicitly `.delete()`'d in a `finally` block.**

- **`src/cv/cvClient.js`** — main-thread wrapper that lazily spawns the
  worker (Vite bundles it via `new Worker(new URL('./cvWorker.js',
  import.meta.url))`) and exposes `ensureCv()` + `classifyShape(width,
  height, buffer)`. Holds a `Map` of pending request promises keyed by id.

- **`src/cv/shapeClassifier.js`** — main-thread shim. Reads
  `ctx.getImageData()` off the canvas and forwards the buffer to the
  worker as a **transferable** (zero-copy). Caller can't reuse the buffer
  after the call.

- **`src/components/PredictionPanel.jsx`** — pure display, no logic. Takes
  `{ prediction }` and renders the big label + confidence + score bars.

- **`src/components/HowItWorks.jsx`** — static explainer. 4-step pipeline
  diagram + OpenCV API mapping table + tech-stack grid. No props.

- **`src/utils/canvasUtils.js`** — `renderStrokes()` helper used by
  `WebcamCapture` to paint both overlay canvases. Also exports
  `flattenStrokes()` which is unused at the moment but kept (one-liner,
  cheap).

- **`src/utils/speech.js`** — `speak(text)` wraps `window.speechSynthesis`
  with cancel-then-speak so utterances don't queue up.

---

## 4. The pipeline

```
Webcam video frame
   │
   ▼  MediaPipe HandLandmarker (in useHandTracking)
   ▼  thumb-index pinch detected → emit fingertip {x, y}
   │
   ▼  WebcamCapture.onPoint → push into current stroke
   ▼  WebcamCapture redraws BOTH overlays:
   │    overlayRef   (glow, what user sees, transparent bg)
   │    exportRef    (white-on-black, what OpenCV sees)
   ▼  pinch released → stroke closes → onStrokeEnd fires
   │
   ▼  App.runClassification (if autoClassify, or on Classify click):
   ▼    await ensureCv()       ← lazy OpenCV load, only first time
   ▼    classifyShape(canvas)  ← OpenCV pipeline below
   │
   ▼  cv.imread → cv.cvtColor → cv.threshold (binary)
   ▼  cv.findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)
   ▼  pick largest contour by cv.contourArea
   ▼  perimeter = cv.arcLength
   ▼  circularity = 4πA / P²
   ▼  cv.approxPolyDP(ε = 0.04·P, closed=true) → corner count
   ▼  cv.boundingRect → aspect, bbox fill
   ▼  score circle / triangle / square → highest wins
   │
   ▼  setPrediction → PredictionPanel renders
   ▼  if voiceOn: speak("This is a circle") (de-duped)
```

### Scoring rules (see `shapeClassifier.js`)

- **circle** ← high circularity, penalize 3-5 corners
- **triangle** ← exactly 3 corners + ~50 % bbox fill
- **square** ← exactly 4 corners + aspect ≈ 1 + high bbox fill

---

## 5. Color palette

All theme tokens are CSS custom properties in `src/styles/index.css`.
**Edit them there — don't hard-code colors in components.**

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0f1117` | App background (very dark, slightly blue) |
| `--panel` | `#181b25` | Card / button surface |
| `--panel-2` | `#20243044` | Subtle nested surface (semi-transparent) |
| `--border` | `#2a2f3d` | Card / button border |
| `--text` | `#e7ebf3` | Primary text (near-white, cool tint) |
| `--muted` | `#8a93a8` | Secondary text, labels, hints |
| `--accent` | `#7c9cff` | Primary accent (blue) — gradients, focus, glow |
| `--accent-2` | `#5cd6c0` | Secondary accent (teal) — gradient end stop, code highlights |
| `--good` | `#59d68b` | Success state ("Ready" status) |
| `--bad` | `#f06b6b` | Error state |

The two-accent gradient (`--accent → --accent-2`) is the visual signature
— shows up on the big prediction label (text gradient), pipeline step
numbers (filled disc), confidence bar fills, and primary buttons.

**Typography:** Inter via system-ui fallback. Tabular numerals on
confidence percentages.

**Color scheme:** dark only. CSS declares `color-scheme: dark` at `:root`.

---

## 6. User interface

### Layout

```
┌────────────────────────────────────────────────────────┐
│  HEADER  Air Drawing · Shape Recognizer               │
│          [Ready] / [Compiling OpenCV…] / [⚠ Error]    │
├──────────────────────────────────┬─────────────────────┤
│   ┌── tabs ────────────────┐     │   Shape             │
│   │ 📷 Draw │ ℹ How it works│    │   ╔═══════════╗    │
│   └────────────────────────┘     │   ║  Circle   ║    │
│                                  │   ╚═══════════╝    │
│   ┌─── stage ───────────────┐    │   Confidence 87.2% │
│   │   <video> + overlays    │    │                    │
│   │   (camera feed)         │    │   Scores           │
│   └─────────────────────────┘    │   Circle ▓▓▓ 87%   │
│                                  │   Square ▓ 9%      │
│   [Classify] [Reset]  ☐ Auto     │   Triangle 4%      │
│   ☐ Speak                        │                    │
│   Tip: pinch thumb + index…      │                    │
└──────────────────────────────────┴─────────────────────┘
```

### Tabs

Two views: **📷 Draw** (default) and **ℹ How it works**. No nested mode
selector — there's only one input surface and one classifier.

When "How it works" is selected, the stage + controls disappear and the
right sidebar swaps from the prediction panel to an "At a glance" summary.

### Controls

- **Classify** (primary, blue gradient). Disabled only during `cvLoading`.
  Tooltip warns about the first-click freeze: *"First click loads OpenCV
  (~3-10s freeze)"*.
- **Reset** — clears the active surface and the prediction.
- **Auto-classify on stroke end** (default ON) — every pinch-release fires
  `runClassification` automatically.
- **🔊 Speak result** (default OFF) — Web Speech API. Disabled +
  tooltipped if unsupported.

### Loading & error states

- **Header status string** is the single source of truth:
  - `"Ready — first Classify loads OpenCV"` — fresh page load
  - `"Compiling OpenCV.js…"` — during `cvLoading`
  - `"OpenCV ready"` — post-load
  - `"⚠ <error message>"` — on failure
- **Stage overlay** appears during `cvLoading` with a spinner + hint.
  Uses solid semi-transparent background (no `backdrop-filter`, which is
  expensive and made things visibly worse during the WASM-compile freeze).
- **Webcam errors** (permission denied, no devices) surface as a toast
  inside the stage — see `WebcamCapture.jsx`.

### Responsive behavior

- Workspace switches from 2-column to 1-column at `max-width: 980px`.
- Pipeline diagram in HowItWorks stacks vertically at `max-width: 1100px`.

---

## 7. Lifecycle

### App load (cold start)

1. React mounts `<App/>`. **Page is fully interactive at first paint.**
2. `useEffect` calls `ensureCv()` — this spawns the OpenCV worker and
   kicks off OpenCV's WASM load **on the worker thread**. The main thread
   is not blocked at any point.
3. Webcam tab is the default view, so `<WebcamCapture/>` mounts
   immediately and requests camera permission.
4. Once camera is granted: `useHandTracking.start(video)` dynamically
   imports MediaPipe (~125 KB chunk, code-split), loads the hand model
   from CDN, starts the rAF detect loop.
5. When the worker reports `cv.Mat` ready (a few seconds later), App sets
   `cvReady = true` and the header status flips to "OpenCV ready".

### First Classify click

1. `runClassification` calls `await ensureCv()` — this resolves
   instantly if the worker is ready, or queues until it is.
2. `shapeClassifier.classifyShape(canvas)` grabs the canvas's ImageData
   and sends `(width, height, buffer)` to the worker (buffer is
   transferred, not copied).
3. Worker runs `cv.matFromImageData → cvtColor → threshold → findContours
   → approxPolyDP → score`, deletes all Mats, returns the result.
4. Result is rendered in the PredictionPanel.

**There is no UI freeze at any point** — that was the whole point of
moving OpenCV into a worker. The previous version's 3–10 s WASM-compile
freeze on first Classify is gone.

### Stroke end

1. WebcamCapture's pinch-end handler calls `props.onStrokeEnd`.
2. `App.handleStrokeEnd` runs; if `autoClassify` is on, calls
   `runClassification()`.

---

## 8. History (decisions you should know about)

- **Built initially with**: React + Vite + TFJS (MNIST CNN, in-browser
  trained + IndexedDB cached) + MediaPipe + canvas drawing surface +
  pure-JS Douglas-Peucker shape detection.

- **First refactor**: replaced pure-JS shape detection and the canvas-based
  digit preprocessor with OpenCV.js. The project directory is named
  `OpenCV/` and the user wanted a real OpenCV pipeline.

- **Performance crash**: with OpenCV.js + TFJS + MNIST training all loading
  in parallel at boot, the page froze for 30+ seconds and was unresponsive
  to clicks. We tried `requestIdleCallback` deferral, smaller MNIST chunks,
  `tf.nextFrame()` between training batches, lazy OpenCV — none of these
  fully fixed it because the OpenCV WASM compile is inherently blocking.

- **Simplification (this version)**: user asked to "simplify it so that it
  could maybe work if it's less complex". We:
  - Removed the canvas drawing surface entirely (webcam only).
  - Removed digit recognition entirely (shapes only).
  - Removed TensorFlow.js, MNIST data loader, model loader, digit
    preprocessor, IndexedDB cache.
  - Bundle dropped from ~305 KB gzip to ~52 KB gzip.
  - Boot is now zero-work; OpenCV still loads lazily on first Classify.

- **Known bug (fixed earlier)**: `tf.tensor1d() requires values to be a
  flat/TypedArray` — `tf.util.createShuffledIndices()` returns a
  `Uint32Array`, which TFJS's `isTypedArray` rejects (only
  Float32/Int32/Uint8/Uint8Clamped). This bug no longer applies (TFJS is
  gone) but is documented in case someone re-adds training.

---

## 9. Useful commands

```bash
npm install            # 3 runtime deps + 2 dev deps
npm run dev            # http://localhost:5173 (auto-opens)
npm run build          # production build → dist/
npm run preview        # serve dist/ on port 4173
```

No tests, no linter, no formatter. Build is ~1 second.

---

## 10. Common pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| "Loading OpenCV…" counter climbs forever and never clears | `await loadCv()` is awaiting OpenCV's `cv` module as a thenable (it has a `then` method) and never resumes. Or the worker overwrites `cv.onRuntimeInitialized`, breaking OpenCV's own `cv.Mat` registration. | See `cvWorker.js`: the polling promise must NOT `return self.cv`, and we must NOT register a callback on `cv.onRuntimeInitialized`. Poll `self.cv.Mat` instead. |
| Stage overlay stuck "Compiling OpenCV…" but counter does tick | Slow download from `docs.opencv.org` (it's not a real CDN) or slow WASM compile. | Run `curl -fL -o public/opencv-min.js https://docs.opencv.org/4.10.0/opencv.js` to self-host (eliminates network), or run `./scripts/build-opencv.sh` to get the minimal build (eliminates network AND compile). |
| Webcam tab shows "Camera error" | Browser denied permission, or no camera | Re-grant permission; browsers only expose `getUserMedia` on `https://` or `localhost`. |
| "Cannot read properties of undefined (reading 'Mat')" | Code ran before `ensureCv()` resolved | All cv-using main-thread code must `await ensureCv()` first (`shapeClassifier.js` and `App.runClassification` already do). |
| Classification returns null | Stroke too small (< 50 px²) — see `shapeClassifier.js` early-return | Draw a bigger shape. |
| Predictions never update | `onStrokeEnd` not firing | Check that pinch is releasing (thumb and index fingers move > 7% apart). |
| Worker fetches `/opencv_js.wasm` but gets ~1.5 KB of HTML back (status 200) | Vite SPA fallback returning `index.html` for an unknown route. The file isn't in `public/`, or emscripten's `locateFile` prepended `scriptDirectory` and pointed at `/src/cv/opencv_js.wasm`. | Use the single-file `opencv-min.js` (WASM embedded as base64). Do not try to split it into a separate `.wasm` file — multiple emscripten code paths depend on the inline data URL. |

---

## 11. Conventions Claude should follow when extending this code

- **Default to the simpler version.** This codebase was deliberately
  simplified. Don't reintroduce removed features (canvas drawing, digit
  recognition, model training, IndexedDB caching, "How it works" tabs that
  describe pipelines we don't have) unless the user asks.
- **No TFJS, no ML models.** The pipeline is OpenCV + heuristics. If you
  need to add classification of new shape types, prefer extending the
  heuristic over reaching for a model.
- **All CV calls go through the worker** (`cvClient.classifyShape` or new
  RPC types added to `cvWorker.js`). The main thread never touches
  `window.cv` — there is no `window.cv` here.
- **Every `cv.Mat` allocation needs `.delete()`** in a `finally` block,
  inside the worker. WASM-heap, not GC'd.
- **The worker MUST stay a classic worker** (no `{ type: 'module' }` in
  the `new Worker(...)` call). It uses `importScripts()` to load OpenCV
  from the CDN, which only works in classic workers.
- **Don't move OpenCV back to the main thread.** The whole reason it's in
  a worker is to keep the page responsive during the ~8 MB WASM compile.
- **OpenCV's `cv` module is a thenable** — it exposes a `then` method.
  This means: never `return cv` (or any `Promise.resolve(cv)`) from an
  async function. Doing so makes JS await the module as if it were a
  Promise, and `cv.then` doesn't resolve in a way that unblocks awaiters,
  so the calling function hangs forever. The worker reaches `cv` via
  `self.cv` directly; the load function returns nothing.
- **Don't register a handler on `cv.onRuntimeInitialized`.** OpenCV.js
  sets that callback internally to register `cv.Mat` and the other
  classes after WASM instantiates. Overwriting it (or even chaining
  naively) can prevent that setup from running. Poll `self.cv.Mat`
  instead — it's race-free and doesn't depend on internals.
- **Don't introduce a UI library.** No Tailwind, no shadcn, no MUI. The
  hand-rolled CSS with custom properties is the design system.
- **Don't introduce a state library.** Plain React state + refs.
- **Don't introduce a backend.** Everything stays browser-only.
- **WebcamCapture's imperative API is the contract.** If you ever add a
  second input surface (e.g., file upload), it must expose the same
  `{ getCanvas, getStrokes, getLastStroke, clear }` so `App` doesn't need
  to branch.
- **Status messages in the header** are the primary loading-state signal.
  Wire any new async work into the same status string rather than adding
  new UI.
- **Don't add emojis to UI strings** unless replacing existing ones. The
  few emojis present (📷 ℹ 🔊) are intentional iconography.
