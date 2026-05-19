/**
 * Draws a list of strokes (each stroke = array of {x, y}) onto a canvas.
 * Used both for the main drawing surface and for the live webcam overlay.
 *
 * White ink on black background — matches MNIST.
 */
export function renderStrokes(canvas, strokes, currentStroke = null, {
  lineWidth = 18,
  background = '#000',
  color = '#fff',
} = {}) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const all = currentStroke ? [...strokes, currentStroke] : strokes;
  for (const stroke of all) {
    if (stroke.length < 2) {
      // Render a single dot for taps.
      if (stroke.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke[0].x, stroke[0].y, lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) {
      ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();
  }
}

export function flattenStrokes(strokes) {
  const out = [];
  for (const s of strokes) for (const p of s) out.push(p);
  return out;
}
