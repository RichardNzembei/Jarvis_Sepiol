"use client";

import { motion, useReducedMotion } from "framer-motion";
import { SPRING, TAP } from "@/lib/motion";

type ActionKey = "agent" | "gmail" | "github" | "spotify";

const ACTIONS: Array<{ key: ActionKey; label: string; icon: React.ReactNode }> = [
  { key: "agent", label: "Sepiol", icon: <SparkIcon /> },
  { key: "gmail", label: "Gmail", icon: <MailIcon /> },
  { key: "github", label: "GitHub", icon: <GitIcon /> },
  { key: "spotify", label: "Spotify", icon: <MusicIcon /> },
];

const ringMask =
  "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))";

export default function Sidebar({
  accent,
  onAction,
  disabled,
  paused = false,
}: {
  accent: string;
  onAction: (key: ActionKey) => void;
  disabled?: boolean;
  paused?: boolean; // tab hidden → stop infinite loops
}) {
  const reduce = useReducedMotion();
  const loop = !reduce && !paused;

  return (
    <aside
      style={{
        position: "fixed",
        right: 18,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        gap: 24,
        alignItems: "flex-end",
      }}
    >
      {ACTIONS.map((a, i) => (
        <motion.button
          key={a.key}
          type="button"
          aria-label={a.label}
          disabled={disabled}
          onClick={() => onAction(a.key)}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 56, scale: 0.4 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ ...SPRING.bounce, delay: 0.25 + i * 0.13 }}
          whileHover={reduce ? undefined : { scale: 1.16, x: -2 }}
          whileTap={{ scale: TAP }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--fg-muted)",
              textShadow: "0 1px 4px rgba(0,0,0,0.6)",
            }}
          >
            {a.label}
          </span>

          {/* icon disc with crazy rings */}
          <span
            style={{
              position: "relative",
              width: 54,
              height: 54,
              display: "grid",
              placeItems: "center",
            }}
          >
            {/* accent ring (static — rotating a conic-gradient re-rastered every
                frame; the pulsing aura below carries the life, far cheaper) */}
            <span
              aria-hidden
              style={{
                position: "absolute",
                inset: -3,
                borderRadius: "50%",
                background: `conic-gradient(from 210deg, transparent, ${accent}, transparent 60%)`,
                WebkitMask: ringMask,
                mask: ringMask,
                opacity: 0.9,
              }}
            />
            {/* pulsing aura */}
            {loop && (
              <motion.span
                aria-hidden
                animate={{ scale: [1, 1.55], opacity: [0.5, 0] }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  delay: i * 0.45,
                  ease: "easeOut",
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: `1px solid ${accent}`,
                }}
              />
            )}
            {/* the disc */}
            <span
              style={{
                position: "relative",
                zIndex: 1,
                width: 48,
                height: 48,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                color: "#fff",
                background: `radial-gradient(circle at 35% 30%, ${accent}, color-mix(in srgb, ${accent} 55%, #0b1120))`,
                boxShadow: `0 8px 22px -8px ${accent}`,
              }}
            >
              <motion.span
                animate={loop ? { y: [0, -3, 0] } : { y: 0 }}
                transition={{
                  duration: 2.4 + i * 0.3,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                style={{ display: "grid", placeItems: "center" }}
              >
                {a.icon}
              </motion.span>
            </span>
          </span>
        </motion.button>
      ))}
    </aside>
  );
}

/* ---- icons ---- */
function SparkIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9z" />
      <path d="M18 14l.9 2.4L21 17l-2.1.6L18 20l-.9-2.4L15 17l2.1-.6z" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}
function GitIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="17" cy="8" r="2.4" />
      <path d="M6 8.4v7.2" />
      <path d="M17 10.4a6 6 0 0 1-6 6H8.4" />
    </svg>
  );
}
function MusicIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="7" cy="18" r="2.6" />
      <circle cx="17.5" cy="15.5" r="2.6" />
      <path d="M9.6 18V6.5l10.5-2.6v11.6" />
    </svg>
  );
}
