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

/**
 * The JARVIS leitmotif — C5·E5·G5, the same triad `granted` has always played.
 * Every "voice of the interface" sound below is a variation of it (a fragment,
 * a compression, a stretch, a minor inversion), so the whole app rhymes. Kept
 * at existing gain levels: leitmotifs work subconsciously — the moment you
 * notice the system, it's too loud. Physical foley (swoosh/land/hop) stays
 * non-motif on purpose: those are objects in the room, not Jarvis speaking.
 */
const THEME = [523.25, 659.25, 783.99] as const; // C5, E5, G5
const THEME_MINOR_DOWN = [261.63, 207.65, 174.61] as const; // C4, Ab3, F3 — inverted, fallen

/** Play a note sequence as one gesture. */
function motif(
  notes: readonly number[],
  opts: { step?: number; dur?: number; type?: OscillatorType; gain?: number; delay?: number } = {},
) {
  const { step = 0.06, dur = 0.18, type = "triangle", gain = 0.15, delay = 0 } = opts;
  notes.forEach((freq, i) => tone({ freq, dur, type, gain, delay: delay + i * step }));
}

/** Sound effects, mapped to assistant states + UI interactions. */
export const sfx = {
  /** start listening — the motif's first interval, rising (C5 → E5) */
  press() {
    tone({ freq: THEME[0], to: THEME[1], dur: 0.16, type: "triangle", gain: 0.2 });
  },
  /** release / send — the motif's top note falling home an octave (G5 → C4) */
  send() {
    tone({ freq: THEME[2], to: THEME[0] / 2, dur: 0.22, type: "sawtooth", gain: 0.14 });
  },
  /** reply arrived — the full motif compressed to ~180ms */
  reply() {
    motif(THEME, { step: 0.06, dur: 0.2, type: "sine", gain: 0.15 });
  },
  /** media interaction — short airy swoosh (foley, non-motif) */
  swoosh() {
    tone({ freq: 1200, to: 480, dur: 0.18, type: "triangle", gain: 0.1 });
  },
  /** error — the motif inverted into minor and dropped low, falling away */
  error() {
    motif(THEME_MINOR_DOWN, { step: 0.11, dur: 0.2, type: "square", gain: 0.11 });
  },
  /** JARVIS boot — power-up sweep, then the motif stretched out as the shimmer */
  boot() {
    tone({ freq: 90, to: 190, dur: 0.75, type: "sine", gain: 0.16 });
    tone({ freq: 300, to: 540, dur: 0.6, type: "triangle", gain: 0.08, delay: 0.06 });
    motif(THEME, { step: 0.14, dur: 0.4, type: "sine", gain: 0.08, delay: 0.32 });
    tone({ freq: THEME[0] * 2, dur: 0.5, type: "sine", gain: 0.07, delay: 0.74 }); // C6 crown
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
  /** Access granted — the motif in full ceremony: triad, octave crown, sparkle */
  granted() {
    motif(THEME, { step: 0.12, dur: 0.17, type: "triangle", gain: 0.14 });
    tone({ freq: THEME[0] * 2, dur: 0.55, type: "sine", gain: 0.16, delay: 0.38 }); // C6
    tone({ freq: THEME[2] * 2, dur: 0.5, type: "sine", gain: 0.07, delay: 0.44 }); // G6 sparkle
  },
};
