"use client";

/**
 * The app's nervous system: ONE requestAnimationFrame loop that writes a few
 * CSS custom properties on :root. Every layer (orb, string, backgrounds) reads
 * them in CSS — zero React re-renders, and effects compose instead of fighting.
 *
 *   --breath        0..1 sine — the room inhales; rate follows assistant state
 *   --gaze-x/-y    −1..1 — eased pointer attention that decays when you stop
 *   --pulse-period  seconds — heartbeat rate for the string's lub-dub keyframe
 *
 * Vars live on :root (not inside Home) so the lock screen breathes too.
 * Design rule enforced here: nothing moves at constant velocity — the gaze
 * eases toward the pointer and loses interest over ~6s; breath is a sine.
 */

export type VitalsStatus =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

/** Breath cycle length (s): calm at rest, shallow-and-quick while thinking. */
const BREATH_PERIOD: Record<VitalsStatus, number> = {
  idle: 4.5,
  listening: 3.2,
  thinking: 1.8,
  speaking: 3.0,
  error: 6.5, // one long held breath
};

/** Heartbeat cycle (s): ~52bpm at rest, ~90bpm while thinking. */
const PULSE_PERIOD: Record<VitalsStatus, number> = {
  idle: 1.15,
  listening: 0.95,
  thinking: 0.67,
  speaking: 0.8,
  error: 1.5,
};

const GAZE_IDLE_MS = 6000; // stop moving and it slowly loses interest

let status: VitalsStatus = "idle";
let raf: number | null = null;
let running = false;
let reduced = false;

let phase = 0; // breath phase (radians) — continuous across rate changes
let lastT = 0;
let gazeX = 0;
let gazeY = 0;
let targetX = 0;
let targetY = 0;
let lastPointerAt = 0;

// Last written values — skip style writes when nothing perceptibly changed.
let wBreath = -1;
let wGx = 99;
let wGy = 99;

function root(): HTMLElement | null {
  return typeof document !== "undefined" ? document.documentElement : null;
}

export function setVitalsStatus(s: VitalsStatus): void {
  status = s;
  root()?.style.setProperty("--pulse-period", `${PULSE_PERIOD[s]}s`);
}

function frame(t: number) {
  raf = null;
  const el = root();
  if (!el || !running) return;

  const dt = Math.min(0.1, lastT ? (t - lastT) / 1000 : 0.016);
  lastT = t;

  // Breath: advance phase at the status rate; amplitude 0 under reduced motion.
  phase += ((Math.PI * 2) / BREATH_PERIOD[status]) * dt;
  if (phase > Math.PI * 4) phase -= Math.PI * 2; // keep bounded
  const breath = reduced ? 0 : (Math.sin(phase) + 1) / 2;

  // Gaze: ease toward the pointer; after inattention, ease home to center.
  if (t - lastPointerAt > GAZE_IDLE_MS) {
    targetX += (0 - targetX) * Math.min(1, dt * 0.6);
    targetY += (0 - targetY) * Math.min(1, dt * 0.6);
  }
  const k = 1 - Math.exp(-dt * 3);
  gazeX += ((reduced ? 0 : targetX) - gazeX) * k;
  gazeY += ((reduced ? 0 : targetY) - gazeY) * k;

  if (Math.abs(breath - wBreath) > 0.002) {
    wBreath = breath;
    el.style.setProperty("--breath", breath.toFixed(3));
  }
  if (Math.abs(gazeX - wGx) > 0.001 || Math.abs(gazeY - wGy) > 0.001) {
    wGx = gazeX;
    wGy = gazeY;
    el.style.setProperty("--gaze-x", gazeX.toFixed(3));
    el.style.setProperty("--gaze-y", gazeY.toFixed(3));
  }

  raf = requestAnimationFrame(frame);
}

/** Start the loop. Returns a cleanup function. Safe to call once per app. */
export function startVitals(): () => void {
  const el = root();
  if (!el || running) return () => {};
  running = true;

  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduced = mq.matches;
  const onMq = () => {
    reduced = mq.matches;
  };
  mq.addEventListener?.("change", onMq);

  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === "touch") return; // presence is a desktop affordance
    targetX = (e.clientX / window.innerWidth) * 2 - 1;
    targetY = (e.clientY / window.innerHeight) * 2 - 1;
    lastPointerAt = performance.now();
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  // Pause the loop entirely while the tab is hidden (same discipline as the
  // ambient layers); reset lastT so dt doesn't spike on return.
  const onVis = () => {
    if (document.hidden) {
      if (raf != null) cancelAnimationFrame(raf);
      raf = null;
    } else if (running && raf == null) {
      lastT = 0;
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener("visibilitychange", onVis);

  setVitalsStatus(status);
  raf = requestAnimationFrame(frame);

  return () => {
    running = false;
    if (raf != null) cancelAnimationFrame(raf);
    raf = null;
    mq.removeEventListener?.("change", onMq);
    window.removeEventListener("pointermove", onPointer);
    document.removeEventListener("visibilitychange", onVis);
  };
}
