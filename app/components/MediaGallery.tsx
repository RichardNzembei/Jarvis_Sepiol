"use client";

import { useEffect, useState } from "react";
import {
  AnimatePresence,
  motion,
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
}: {
  accent: string;
  active: boolean; // listening / speaking → voice-reactive pulse
}) {
  const reduceMotion = useReducedMotion();
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

  return (
    <>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 16,
          padding: "4px 0",
        }}
      >
        {MEDIA.map((item, i) => {
          const hidden = open === i; // single owner of the layoutId while open
          return (
            <motion.button
              key={item.id}
              variants={reduceMotion ? fadeVariants : cardVariants}
              animate={
                active && !reduceMotion
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
              <div
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
                    src={encodeURI(item.src)}
                    alt=""
                    draggable={false}
                    decoding="async"
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

                {/* movie-like specular light sweep */}
                {!reduceMotion && (
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
                        "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)",
                      mixBlendMode: "screen",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </div>

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
                    src={encodeURI(item.src)}
                    alt=""
                    draggable={false}
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
                src={encodeURI(openItem.src)}
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
