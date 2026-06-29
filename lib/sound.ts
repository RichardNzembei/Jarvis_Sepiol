/**
 * Tiny Web Audio sound engine — all SFX are synthesized, so there are no audio
 * assets to ship and it works offline.
 *
 * Rules honored:
 * - AudioContext is created lazily and resumed only inside a user gesture
 *   (browsers block audio before that). Call `unlock()` from a pointer handler.
 * - Respects a mute toggle, persisted to localStorage.
 */

let ctx: AudioContext | null = null;
let muted = false;

function readMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("jarvis-muted") === "1";
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  if (typeof window !== "undefined") {
    window.localStorage.setItem("jarvis-muted", value ? "1" : "0");
  }
}

/** Resume/create the AudioContext. Must be called from a user gesture. */
export function unlock(): void {
  if (typeof window === "undefined") return;
  if (muted) return;
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new Ctor();
      muted = readMuted();
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* audio unavailable — fail silent */
  }
}

type Tone = {
  freq: number;
  to?: number; // glide target frequency
  dur: number; // seconds
  type?: OscillatorType;
  gain?: number;
  delay?: number; // seconds from now
};

function tone({ freq, to, dur, type = "sine", gain = 0.18, delay = 0 }: Tone) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  // Punchy envelope: fast attack, exponential decay.
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Sound effects, mapped to assistant states + UI interactions. */
export const sfx = {
  /** start listening — bright rising blip */
  press() {
    tone({ freq: 420, to: 760, dur: 0.16, type: "triangle", gain: 0.2 });
  },
  /** release / send — quick descending whoosh */
  send() {
    tone({ freq: 700, to: 220, dur: 0.22, type: "sawtooth", gain: 0.14 });
  },
  /** reply arrived — two-note confirming chime */
  reply() {
    tone({ freq: 660, dur: 0.16, type: "sine", gain: 0.16 });
    tone({ freq: 990, dur: 0.26, type: "sine", gain: 0.16, delay: 0.1 });
  },
  /** media interaction — short airy swoosh */
  swoosh() {
    tone({ freq: 1200, to: 480, dur: 0.18, type: "triangle", gain: 0.1 });
  },
  /** error — low double buzz */
  error() {
    tone({ freq: 200, dur: 0.18, type: "square", gain: 0.12 });
    tone({ freq: 150, dur: 0.22, type: "square", gain: 0.12, delay: 0.14 });
  },
  /** JARVIS boot — a rising interface power-up with a shimmer, film-style */
  boot() {
    tone({ freq: 90, to: 190, dur: 0.75, type: "sine", gain: 0.16 });
    tone({ freq: 300, to: 540, dur: 0.6, type: "triangle", gain: 0.08, delay: 0.06 });
    tone({ freq: 1320, dur: 0.5, type: "sine", gain: 0.09, delay: 0.44 });
    tone({ freq: 1760, dur: 0.55, type: "sine", gain: 0.08, delay: 0.56 });
  },
  /** soft landing — a quiet, low muffled thud for the hopping figure */
  land() {
    tone({ freq: 150, to: 60, dur: 0.16, type: "sine", gain: 0.07 });
    tone({ freq: 90, to: 48, dur: 0.12, type: "triangle", gain: 0.04, delay: 0.01 });
  },
  /** mid-air hop — a barely-there airy lift */
  hop() {
    tone({ freq: 320, to: 540, dur: 0.1, type: "sine", gain: 0.03 });
  },
  /** Access granted — triumphant ascending arpeggio + sparkle */
  granted() {
    tone({ freq: 523, dur: 0.16, type: "triangle", gain: 0.14 }); // C5
    tone({ freq: 659, dur: 0.16, type: "triangle", gain: 0.14, delay: 0.12 }); // E5
    tone({ freq: 784, dur: 0.18, type: "triangle", gain: 0.15, delay: 0.24 }); // G5
    tone({ freq: 1047, dur: 0.55, type: "sine", gain: 0.16, delay: 0.38 }); // C6
    tone({ freq: 1568, dur: 0.5, type: "sine", gain: 0.07, delay: 0.44 }); // G6 sparkle
  },
};
