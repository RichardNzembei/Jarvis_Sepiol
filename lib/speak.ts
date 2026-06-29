/**
 * Shared text-to-speech in the JARVIS voice (browser SpeechSynthesis).
 * Picks the most British male voice available and speaks in ≤200-char chunks
 * so Chrome doesn't truncate. Must be triggered from a user gesture.
 */

let voice: SpeechSynthesisVoice | null = null;
let inited = false;

function pick() {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const voices = synth.getVoices();
  if (!voices.length) return;
  const tests: Array<(v: SpeechSynthesisVoice) => boolean> = [
    (v) => v.name === "Daniel",
    (v) => /Google UK English Male/i.test(v.name),
    (v) => v.lang === "en-GB" && /male|daniel|arthur|george|oliver/i.test(v.name),
    (v) => v.lang === "en-GB",
    (v) => v.lang.toLowerCase().startsWith("en-gb"),
    (v) => v.lang.toLowerCase().startsWith("en"),
  ];
  for (const t of tests) {
    const match = voices.find(t);
    if (match) {
      voice = match;
      return;
    }
  }
}

export function initVoice() {
  if (inited || typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  inited = true;
  pick();
  synth.addEventListener?.("voiceschanged", pick);
}

function chunk(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [text];
  const out: string[] = [];
  for (const s of sentences) {
    let t = s.trim();
    if (!t) continue;
    while (t.length > 200) {
      let cut = t.lastIndexOf(" ", 200);
      if (cut <= 0) cut = 200;
      out.push(t.slice(0, cut).trim());
      t = t.slice(cut).trim();
    }
    if (t) out.push(t);
  }
  return out;
}

/**
 * Speak text. `onEnd` fires when the last chunk finishes (or immediately if TTS
 * is unavailable); `onStart` fires when the first chunk actually begins playing
 * — useful to tell whether autoplay was allowed vs. blocked until a gesture.
 */
export function speak(text: string, onEnd?: () => void, onStart?: () => void) {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  if (!synth) {
    onEnd?.();
    return;
  }
  initVoice();
  synth.cancel();
  const parts = chunk(text);
  if (!parts.length) {
    onEnd?.();
    return;
  }
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part);
    if (voice) u.voice = voice;
    u.rate = 1.0;
    u.pitch = 0.92;
    if (i === 0 && onStart) u.onstart = () => onStart();
    if (i === parts.length - 1) {
      u.onend = () => onEnd?.();
      u.onerror = () => onEnd?.();
    }
    synth.speak(u);
  });
}
