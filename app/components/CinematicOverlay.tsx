"use client";

/**
 * Cinematic finish: a vignette to frame the scene and a faint film grain.
 * Purely decorative, pointer-events: none, sits just behind the UI (z -1).
 * Static (no animation) to keep it free on the main thread.
 */

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export default function CinematicOverlay() {
  return (
    <>
      {/* vignette */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: -1,
          pointerEvents: "none",
          background:
            "radial-gradient(circle at 50% 44%, transparent 48%, rgba(2,6,16,0.55) 100%), linear-gradient(to bottom, rgba(2,6,16,0.45), transparent 14%, transparent 86%, rgba(2,6,16,0.5))",
        }}
      />
      {/* film grain */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: -1,
          pointerEvents: "none",
          backgroundImage: GRAIN,
          backgroundSize: "180px 180px",
          opacity: 0.05,
          mixBlendMode: "overlay",
        }}
      />
    </>
  );
}
