"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useAnimationControls,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import { sfx } from "@/lib/sound";
import { SPRING, TAP } from "@/lib/motion";

type MediaItem = { id: string; type: "image" | "video"; src: string };

// Your media (public/media). The video leads; spaces in image filenames are
// URL-encoded at render.
// The video is the full-screen background (see AmbientVideo); the gallery is
// the photos. The component stays video-capable for future use.
const MEDIA: MediaItem[] = [
  { id: "i0", type: "image", src: "/media/ty.jpeg" },
  { id: "i1", type: "image", src: "/media/WhatsApp Image 2026-06-29 at 09.18.11.jpeg" },
  { id: "i2", type: "image", src: "/media/WhatsApp Image 2026-06-29 at 09.18.12.jpeg" },
  { id: "i3", type: "image", src: "/media/WhatsApp Image 2026-06-at 09.18.12.jpeg" },
  { id: "i4", type: "image", src: "/media/WhatsApp Image 2026-29 at 09.18.12.jpeg" },
  { id: "i5", type: "image", src: "/media/rt.jpeg" },
];

const W = 132;
const H = 176;
const REFLECT_H = 52;

// Route images through Next's image optimizer (resized + WebP) instead of
// shipping the full-resolution source. A 3024×4032 / 1.2 MB photo into a 132px
// thumb drops to ~14 KB this way. Done via the optimizer URL directly so the
// existing layoutId shared-element morph (which lives on the <img>) is untouched.
const opt = (src: string, w: number, q = 75) =>
  `/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=${q}`;

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

// Lively but settled entrance (damping ~18 reads premium; 12 wobbled).
const cardVariants: Variants = {
  hidden: { opacity: 0, y: 40, scale: 0.7, rotate: -6 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    rotate: 0,
    transition: { ...SPRING.bounce, mass: 0.7 },
  },
};

// Reduced-motion: fade only, no transform overshoot.
const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.3 } },
};

export default function MediaGallery({
  accent,
  active,
  paused = false,
}: {
  accent: string;
  active: boolean; // listening / speaking → voice-reactive pulse
  paused?: boolean; // tab hidden → stop the infinite loops entirely
}) {
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion && !paused;
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const openItem = open === null ? null : MEDIA[open];

  /* ---- hopping figure: a little silhouette that jumps card-to-card ---- */
  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameRefs = useRef<Array<HTMLDivElement | null>>([]);
  const posCtrl = useAnimationControls(); // wrapper x/y (the hop arc)
  const bodyCtrl = useAnimationControls(); // inner squash/stretch
  const [hopReady, setHopReady] = useState(false); // figure visible once placed
  // Which card is "in focus" right now + a nonce so the same card can refocus
  // again on a later landing (key change re-fires the animation).
  const [focus, setFocus] = useState<{ idx: number; nonce: number }>({
    idx: -1,
    nonce: 0,
  });

  // Landing point for card `i`: centered horizontally, feet on its top edge,
  // measured live so responsive flex-wrap reflows are always respected.
  const landingFor = (i: number): { x: number; y: number } | null => {
    const c = containerRef.current;
    const f = frameRefs.current[i];
    if (!c || !f) return null;
    const cr = c.getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    return { x: fr.left - cr.left + fr.width / 2, y: fr.top - cr.top };
  };

  const runHopper = animate && open === null;

  useEffect(() => {
    if (!runHopper) return;
    let alive = true;

    const wait = (ms: number) =>
      new Promise<void>((r) => setTimeout(r, ms));

    const loop = async () => {
      // Let the card entrance (staggered springs) settle before measuring.
      await wait(1100);
      // Place the figure on the first card without an arc.
      const start = landingFor(0);
      if (!alive || !start) return;
      posCtrl.set({ x: start.x, y: start.y });
      setHopReady(true);

      let i = 0;
      let nonce = 0;
      while (alive) {
        const from = landingFor(i);
        const nextIdx = (i + 1) % MEDIA.length;
        const to = landingFor(nextIdx);
        if (!from || !to) {
          await wait(400);
          continue;
        }
        // crouch before the leap
        await bodyCtrl.start({
          scaleY: 0.78,
          scaleX: 1.12,
          transition: { duration: 0.14, ease: "easeOut" },
        });
        if (!alive) return;
        sfx.hop();
        // the arc: x glides, y parabola up-and-over
        const peak = Math.min(from.y, to.y) - 64;
        await Promise.all([
          posCtrl.start({
            x: to.x,
            y: [from.y, peak, to.y],
            transition: {
              duration: 0.62,
              x: { ease: "easeInOut" },
              y: { times: [0, 0.5, 1], ease: ["easeOut", "easeIn"] },
            },
          }),
          bodyCtrl.start({
            scaleY: 1.12,
            scaleX: 0.92,
            transition: { duration: 0.3, ease: "easeOut" },
          }),
        ]);
        if (!alive) return;
        // land: squash + soft thud + refocus the card
        sfx.land();
        nonce += 1;
        setFocus({ idx: nextIdx, nonce });
        await bodyCtrl.start({
          scaleY: [0.7, 1],
          scaleX: [1.18, 1],
          transition: { duration: 0.34, ease: "easeOut" },
        });
        if (!alive) return;
        i = nextIdx;
        await wait(900); // rest on the card before the next leap
      }
    };

    loop();
    return () => {
      alive = false;
    };
  }, [runHopper, posCtrl, bodyCtrl]);

  return (
    <>
      <motion.div
        ref={containerRef}
        variants={containerVariants}
        initial="hidden"
        animate="show"
        style={{
          position: "relative", // anchor for the absolutely-positioned hopper
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 16,
          padding: "4px 0",
        }}
      >
        {/* the hopping silhouette — lands on each card in a loop */}
        {animate && (
          <motion.div
            aria-hidden
            animate={posCtrl}
            initial={false}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 28,
              height: 46,
              marginLeft: -14, // center the 28px-wide figure on the landing x
              marginTop: -46, // feet (bottom) sit on the landing y
              zIndex: 5,
              pointerEvents: "none",
              opacity: hopReady ? 1 : 0,
              filter: `drop-shadow(0 3px 4px rgba(0,0,0,0.5))`,
            }}
          >
            <motion.div
              animate={bodyCtrl}
              style={{ width: "100%", height: "100%", transformOrigin: "50% 100%" }}
            >
              {/* a proper human silhouette: head, neck, torso, bent arms,
                  striding legs — with a soft top-down gradient + sheen so it
                  reads as a person, not a blob. */}
              <svg width="28" height="46" viewBox="0 0 28 46" fill="none" aria-hidden>
                <defs>
                  <linearGradient id="figBody" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={accent} stopOpacity="1" />
                    <stop offset="1" stopColor={accent} stopOpacity="0.8" />
                  </linearGradient>
                </defs>
                {/* legs (slight stride + knee bend) */}
                <path
                  d="M12 24 L11 34 L10 43.5"
                  stroke={accent}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M16 24 L17 34 L18.5 43.5"
                  stroke={accent}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* arms (elbow bend, hanging slightly out) */}
                <path
                  d="M10.5 14 L8 19 L7.6 24"
                  stroke={accent}
                  strokeWidth="3.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M17.5 14 L20 19 L20.4 24"
                  stroke={accent}
                  strokeWidth="3.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* torso */}
                <path
                  d="M10 13 Q14 11 18 13 L16.8 25 Q14 26.6 11.2 25 Z"
                  fill="url(#figBody)"
                />
                {/* neck */}
                <rect x="12.6" y="9" width="2.8" height="3.6" rx="1.4" fill={accent} />
                {/* head */}
                <circle cx="14" cy="6" r="4.3" fill={accent} />
                {/* sheen — cheek light + a soft edge highlight down the torso */}
                <ellipse cx="12.4" cy="4.8" rx="1.3" ry="1.7" fill="rgba(255,255,255,0.45)" />
                <path
                  d="M11.5 14 L10.7 24"
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                />
              </svg>
            </motion.div>
          </motion.div>
        )}

        {MEDIA.map((item, i) => {
          const hidden = open === i; // single owner of the layoutId while open
          return (
            <motion.button
              key={item.id}
              variants={reduceMotion ? fadeVariants : cardVariants}
              animate={
                active && animate
                  ? {
                      y: [0, -10, 0],
                      transition: {
                        duration: 0.9,
                        repeat: Infinity,
                        delay: i * 0.12,
                        ease: "easeInOut",
                      },
                    }
                  : { y: 0, transition: { duration: 0.4, ease: "easeOut" } }
              }
              whileHover={
                reduceMotion
                  ? undefined
                  : {
                      scale: 1.16,
                      y: -14,
                      rotate: i % 2 ? 3 : -3,
                      transition: SPRING.pop,
                    }
              }
              whileTap={{ scale: TAP }}
              onHoverStart={() => sfx.swoosh()}
              onClick={() => {
                sfx.reply();
                setOpen(i);
              }}
              aria-label={
                item.type === "video" ? "Play video" : `Open photo ${i}`
              }
              style={{
                flex: "0 0 auto",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              {/* frame */}
              <motion.div
                ref={(el) => {
                  frameRefs.current[i] = el;
                }}
                animate={
                  focus.idx === i && animate
                    ? { scale: [1, 1.055, 1] }
                    : { scale: 1 }
                }
                transition={{ duration: 0.42, ease: "easeOut" }}
                style={{
                  position: "relative",
                  width: W,
                  height: H,
                  borderRadius: 14,
                  overflow: "hidden",
                  border: `1px solid ${accent}66`,
                  background: "#0b1120",
                  boxShadow: `0 10px 30px -14px ${accent}`,
                }}
              >
                {item.type === "video" ? (
                  <motion.video
                    layoutId={`media-${item.id}`}
                    src={item.src}
                    muted
                    loop
                    autoPlay
                    playsInline
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      visibility: hidden ? "hidden" : "visible",
                    }}
                  />
                ) : (
                  <motion.img
                    layoutId={`media-${item.id}`}
                    src={opt(item.src, 384)}
                    alt=""
                    draggable={false}
                    decoding="async"
                    loading="lazy"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      visibility: hidden ? "hidden" : "visible",
                    }}
                  />
                )}

                {/* play badge for the video card */}
                {item.type === "video" && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      pointerEvents: "none",
                    }}
                  >
                    <span
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: "50%",
                        display: "grid",
                        placeItems: "center",
                        background: "rgba(11,17,32,0.55)",
                        border: "1px solid rgba(255,255,255,0.6)",
                        backdropFilter: "blur(2px)",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="#fff">
                        <path d="M4 2.5v11l9-5.5z" />
                      </svg>
                    </span>
                  </div>
                )}

                {/* movie-like specular light sweep. Plain translucent gradient,
                    NOT mix-blend-mode: screen — blend modes force the compositor
                    to read back + re-blend the backdrop every frame (the same
                    lesson CinematicOverlay documents). transform-only stays on
                    the GPU. */}
                {animate && (
                  <motion.div
                    aria-hidden
                    initial={{ x: "-160%" }}
                    animate={{ x: ["-160%", "-160%", "160%"] }}
                    transition={{
                      duration: 5.5,
                      times: [0, 0.78, 1],
                      repeat: Infinity,
                      delay: i * 0.5,
                      ease: "easeInOut",
                    }}
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      width: "60%",
                      background:
                        "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.28) 50%, transparent 70%)",
                      pointerEvents: "none",
                    }}
                  />
                )}

                {/* camera "refocus" on landing: a blurred lens layer that fades
                    out, snapping the photo sharp. Keyed by nonce so the same
                    card refocuses again on each later landing. Fading the
                    layer's opacity (compositor-friendly) reveals the sharp
                    image behind a static backdrop-blur. */}
                {focus.idx === i && animate && (
                  <motion.div
                    key={focus.nonce}
                    aria-hidden
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    style={{
                      position: "absolute",
                      inset: 0,
                      backdropFilter: "blur(5px)",
                      WebkitBackdropFilter: "blur(5px)",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </motion.div>

              {/* mirror floor reflection */}
              <div
                aria-hidden
                style={{
                  width: W,
                  height: REFLECT_H,
                  marginTop: 5,
                  overflow: "hidden",
                  opacity: 0.38,
                  maskImage:
                    "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)",
                  WebkitMaskImage:
                    "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)",
                }}
              >
                {item.type === "image" ? (
                  <img
                    src={opt(item.src, 384)}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    style={{
                      width: W,
                      height: H,
                      objectFit: "cover",
                      transform: "scaleY(-1)",
                      filter: "blur(1px)",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: W,
                      height: REFLECT_H,
                      background: `linear-gradient(to bottom, ${accent}66, transparent)`,
                      filter: "blur(2px)",
                    }}
                  />
                )}
              </div>
            </motion.button>
          );
        })}
      </motion.div>

      {/* Lightbox — shared-element morph from the clicked card */}
      <AnimatePresence>
        {openItem && (
          <motion.div
            key="lightbox"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              display: "grid",
              placeItems: "center",
              padding: 24,
              background: "rgba(7,11,22,0.8)",
              backdropFilter: "blur(10px)",
              cursor: "zoom-out",
            }}
          >
            {openItem.type === "video" ? (
              <motion.video
                layoutId={`media-${openItem.id}`}
                src={openItem.src}
                controls
                autoPlay
                loop
                playsInline
                onClick={(e) => e.stopPropagation()}
                style={{
                  maxWidth: "min(92vw, 720px)",
                  maxHeight: "82vh",
                  borderRadius: 16,
                  boxShadow: `0 30px 90px -20px ${accent}`,
                }}
              />
            ) : (
              <motion.img
                layoutId={`media-${openItem.id}`}
                src={opt(openItem.src, 1080)}
                alt=""
                style={{
                  maxWidth: "min(92vw, 720px)",
                  maxHeight: "82vh",
                  objectFit: "contain",
                  borderRadius: 16,
                  boxShadow: `0 30px 90px -20px ${accent}`,
                }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
