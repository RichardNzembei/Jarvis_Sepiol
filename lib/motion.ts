/**
 * Shared motion tokens — one rhythm across the whole app.
 * Collapses the previously ad-hoc durations/springs into a small, named set so
 * every entrance, tap, and fade feels designed by one hand.
 */

/** Standard press feedback scale (used by every tappable control). */
export const TAP = 0.94;

/** One-shot durations (seconds). Ambient loops keep their own longer timings. */
export const DUR = {
  fast: 0.25, // UI feedback: status pill, error fade
  base: 0.5, // entrances, SVG draws, fades, lightbox
  slow: 2.4, // ambient loops (glow, aura, sheen)
} as const;

/** Spring presets. */
export const SPRING = {
  /** Calm settle — panels, chat bubbles, the lock card. */
  enter: { type: "spring", stiffness: 300, damping: 24 },
  /** Lively-but-settled entrance — gallery cards, sidebar discs. */
  bounce: { type: "spring", stiffness: 300, damping: 18 },
  /** Snappy micro-interaction — hover / tap. */
  pop: { type: "spring", stiffness: 420, damping: 18 },
} as const;
