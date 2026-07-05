"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Full-bleed ambient backdrop using public/media/y.mp4.
 * Heavily blurred + dark-scrimmed so it reads as atmosphere behind the orb
 * (and keeps personal footage non-focal), never competing with foreground text.
 *
 * Honors the specialist guidance: muted + playsInline, and paused when the tab
 * is hidden or when the user prefers reduced motion (data/energy + a11y).
 */
export default function AmbientVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    if (reduceMotion) {
      video.pause();
      return;
    }

    const play = () => void video.play().catch(() => {});
    play();

    const onVisibility = () => {
      if (document.hidden) video.pause();
      else play();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [reduceMotion]);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -4,
        overflow: "hidden",
        pointerEvents: "none",
        // Presence: deepest layer drifts opposite the gaze, slowest of the
        // stack. The video's 1.04 scale leaves margin so edges never show.
        translate:
          "calc(var(--gaze-x, 0) * -6px) calc(var(--gaze-y, 0) * -4px)",
      }}
    >
      <video
        ref={ref}
        src="/media/y.mp4"
        muted
        loop
        playsInline
        preload="metadata"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          // Prominent full-screen background, dialed back a little.
          filter: "saturate(1.16) brightness(0.78) contrast(1.03)",
          transform: "scale(1.04)",
          opacity: 0.92,
        }}
      />
      {/* Light scrim — darkens the top (header) and bottom (gallery) edges for
          text contrast; leaves the footage mostly clear through the middle. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(7,11,22,0.45), rgba(7,11,22,0.16) 26%, rgba(7,11,22,0.16) 64%, rgba(7,11,22,0.55))",
        }}
      />
    </div>
  );
}
