# 🧠 Air Drawing — Number & Shape Recognizer

A browser-only web app that recognises **digits (0–9)** and **basic shapes
(circle, square, triangle)** that you draw either on a canvas (mouse, touch,
stylus) or **in the air with your finger** in front of a webcam.

Everything runs locally in the browser. No backend, no API keys, no data
leaves your machine.

| Layer            | Tech                                            |
| ---------------- | ----------------------------------------------- |
| App framework    | React 18 + Vite 5                               |
| ML runtime       | TensorFlow.js (`@tensorflow/tfjs`)              |
| Hand tracking    | MediaPipe Tasks Vision — `HandLandmarker`       |
| Speech feedback  | Web Speech API (`SpeechSynthesis`) — built-in  |
| Shape detection  | Pure-JS stroke geometry (Douglas-Peucker)       |

---

## ✨ Features

- **Two input modes**
  - 🖌 **Canvas** — draw with mouse, finger, or stylus
  - 📷 **Webcam (air drawing)** — pinch thumb + index finger to draw, release to lift the pen
- **Two classifier modes**
  - 🔢 **Digits 0–9** — small CNN trained on MNIST (in-browser)
  - 🔺 **Shapes** — circle, square, triangle, via stroke-geometry heuristics
- **Live 28×28 preview** showing exactly what the neural net sees
- **Confidence bars** for the top predictions
- **Voice feedback** ("This is a 7") via the Web Speech API
- **First-run training is cached** in IndexedDB → instant load on subsequent visits

---

## 🚀 Quick start

```bash
# 1. install
npm install

# 2. run the dev server (opens http://localhost:5173)
npm run dev
```

That's it. The first time the page loads it will:

1. Download the MNIST dataset (~10 MB, one-time).
2. Train a small CNN in the browser (~30–60 s on a modern laptop, ~98% val acc).
3. Save the trained weights to **IndexedDB** so future loads are instant.

If you ever want to retrain, click **"Clear model cache"** in the UI and reload.

### Production build

```bash
npm run build       # outputs to dist/
npm run preview     # serves dist/ on port 4173 to sanity-check the build
```

---

## 🧪 How to use it

### Canvas mode

1. Pick **Digits** or **Shapes** at the top right.
2. Draw inside the black stage.
3. Each time you finish a stroke, the prediction updates automatically.
4. **Reset** clears the canvas.

> For digits: a single bold stroke centered in the box gives the best results.
> Multiple strokes are fine — every stroke triggers a fresh classification.

### Webcam mode

1. Click **📷 Webcam (Air)**. Grant camera permission.
2. Wait for the toast to say *"Pinch thumb + index to draw"*.
3. **Pinch** your thumb and index fingertips together to start a stroke,
   **release** to lift the pen.
4. Predictions update on each release. Toggle **🔊 Speak result** to hear it.

> The on-screen overlay mirrors the camera horizontally so it looks like a
> selfie mirror — your strokes appear where your finger is.

---

## 📁 Project structure

```
.
├── README.md
├── package.json
├── vite.config.js
├── index.html
└── src/
    ├── main.jsx              # React entry point
    ├── App.jsx               # top-level state + composition
    ├── styles/
    │   └── index.css         # all app styling (dark dashboard theme)
    ├── components/
    │   ├── DrawingCanvas.jsx     # mouse / touch / stylus drawing surface
    │   ├── WebcamCapture.jsx     # webcam + MediaPipe overlay
    │   └── PredictionPanel.jsx   # prediction big-number + confidence bars
    ├── hooks/
    │   └── useHandTracking.js    # lazy-loads MediaPipe Hands, emits fingertip events
    ├── ml/
    │   ├── modelLoader.js        # IndexedDB cache + in-browser MNIST training
    │   ├── mnistData.js          # downloads + decodes the MNIST sprite
    │   ├── preprocess.js         # bbox-crop, center-of-mass align, 28×28 tensor
    │   └── shapeClassifier.js    # Douglas-Peucker + circularity heuristics
    └── utils/
        ├── canvasUtils.js        # shared canvas drawing helpers
        └── speech.js             # thin SpeechSynthesis wrapper
```

---

## 🧠 How it works

### 1. Input → stroke buffer

Both `DrawingCanvas` and `WebcamCapture` build the same data structure:

```ts
type Stroke = { x: number, y: number }[];
type Drawing = Stroke[];
```

…and expose the same imperative ref API (`getCanvas`, `getStrokes`, `clear`),
so the classifier code in `App.jsx` doesn't care which input is active.

For the webcam, `useHandTracking` runs a `requestAnimationFrame` loop that
feeds each video frame into MediaPipe's `HandLandmarker`. When the thumb tip
(landmark 4) and index tip (landmark 8) are within ~7 % of the frame size of
each other we treat that as the **pen-down gesture** and emit the index
fingertip position into the current stroke.

### 2a. Digit pipeline (TensorFlow.js)

`src/ml/preprocess.js` replicates the **standard MNIST normalization**:

1. Find the tight bounding box of inked pixels.
2. Scale it to fit inside a 20×20 inner frame (preserving aspect ratio).
3. Paste it into a 28×28 canvas centered by **center of mass** (not bbox center).
4. Read pixels → normalize to `[0, 1]` → `tf.tensor4d([1, 28, 28, 1])`.

This step is the single most important detail for hand-drawn input — without
it, even a high-accuracy MNIST model misbehaves badly.

The model itself (`src/ml/modelLoader.js`) is a small CNN:

```
Conv(16, 3×3) → MaxPool(2)
Conv(32, 3×3) → MaxPool(2)
Flatten → Dropout(0.25) → Dense(64) → Dense(10, softmax)
```

…trained for 3 epochs on 12 k MNIST examples. Final validation accuracy is
typically **97–98 %**. The trained weights are persisted to IndexedDB under
the key `air-drawing-mnist-v1`.

### 2b. Shape pipeline (heuristics)

We deliberately do **not** run a second neural net for circle/square/triangle.
The drawing surface gives us the exact polyline the user drew, so geometry
is far more reliable (and free of training data) than CNN inference on a
rasterized version.

`src/ml/shapeClassifier.js`:

1. Auto-close the polygon if start/end are close.
2. Compute **circularity** = `4π·A / P²` (1.0 = perfect circle).
3. Simplify the polyline with **Douglas-Peucker** at 4 % of bbox diagonal.
4. Score each candidate:
   - `circle` ← high circularity + few simplified corners
   - `triangle` ← exactly 3 corners + ~50 % bbox fill
   - `square` ← exactly 4 corners + aspect ratio ≈ 1 + high bbox fill

### 3. Voice feedback

`src/utils/speech.js` wraps `window.speechSynthesis`. The app de-duplicates
consecutive identical utterances so you don't hear *"this is a 7, this is a
7, this is a 7"* on every micro-stroke.

---

## 🔧 Configuration / tweaks

| What                              | Where                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| Stroke thickness                  | `DrawingCanvas` / `WebcamCapture` `lineWidth` prop          |
| Pinch sensitivity                 | `PINCH_THRESHOLD` in `src/hooks/useHandTracking.js`         |
| Number of MNIST training epochs   | `epochs` in `trainModel()` (`src/ml/modelLoader.js`)        |
| Shape detection tolerance         | `tolerance = diag * 0.04` in `shapeClassifier.js`           |
| Cached model storage key          | `STORAGE_KEY` in `src/ml/modelLoader.js`                    |

---

## 🩹 Troubleshooting

**The first load is slow.**
That's the one-time MNIST training step. Watch the status indicator in the
header — it streams progress messages. Subsequent loads hit the IndexedDB
cache and are <500 ms.

**Camera permission denied / no devices.**
Browsers only expose `getUserMedia` on `https://` or `http://localhost`. If
you opened the built `dist/` over `file://`, serve it instead:
`npm run preview` (or any static server).

**Hand tracking won't load.**
MediaPipe pulls its WASM bundle and model from a CDN
(`cdn.jsdelivr.net`, `storage.googleapis.com`). If you're offline or on a
restricted network, that fetch will fail. The canvas mode still works fully
offline once the MNIST model is cached.

**Digit predictions look random.**
Make sure your strokes are **bold** and roughly centered. Very thin or tiny
drawings get scaled up by the preprocessor and may pick up artifacts. Try
the "Clear model cache" button + reload to retrain — occasionally the first
training run gets unlucky with the random sample.

**No voice output.**
Web Speech is unavailable in some browsers (notably some Linux builds of
Firefox). The toggle disables itself automatically when unsupported.

---

## 📦 Dependencies

Runtime (3):

- `react`, `react-dom`
- `@tensorflow/tfjs` — model definition, training, inference, IndexedDB IO
- `@mediapipe/tasks-vision` — `HandLandmarker` for the air-drawing mode

Build (2):

- `vite`, `@vitejs/plugin-react`

That's it — no UI framework, no state library, no CV bundle. Total install
is ~150 MB of dev deps (mostly tfjs's WASM bundles); the production build
is ~1.5 MB gzip including tfjs.

---

## 🛣 Possible next steps

- Train a second small CNN on a shape dataset (e.g. Quick, Draw!) for harder
  shapes (star, arrow, heart).
- Replace the pinch gesture with a "draw while index is extended, lift when
  fist closes" heuristic using all 21 landmarks.
- Stream predictions over `BroadcastChannel` to drive a separate spectator
  view (handy for classroom demos).
- Add per-prediction "I was wrong, it should be …" feedback that fine-tunes
  the model in the browser via `model.fit()` on a few user-labelled examples.

---

## License

MIT. The MNIST sprite + label files are hosted by Google for the TensorFlow.js
demos and are used here under the same terms.
