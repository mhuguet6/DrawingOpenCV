/**
 * Tiny wrapper around the Web Speech API's SpeechSynthesis.
 * Safe to call in environments where it's not available (no-op).
 */
let lastUtterance = null;

export function speak(text, { rate = 1, pitch = 1, volume = 1 } = {}) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  // Cancel anything currently being spoken so predictions don't queue up.
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  u.pitch = pitch;
  u.volume = volume;
  lastUtterance = u;
  window.speechSynthesis.speak(u);
}

export function isSpeechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
