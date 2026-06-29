"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "framer-motion";
import AmbientVideo from "./AmbientVideo";
import CodeStream from "./CodeStream";
import CinematicOverlay from "./CinematicOverlay";
import MediaGallery from "./MediaGallery";
import { sfx, unlock as unlockAudio } from "@/lib/sound";
import { speak } from "@/lib/speak";
import styles from "../page.module.css";
import { SPRING } from "@/lib/motion";

const ACCENT = "#818cf8"; // indigo (locked)
const GRANTED = "#34d399"; // green (access granted)

const WELCOME_SPEECH =
  "Welcome to JARVIS. This agent belongs to Sepiol. " +
  "You are currently locked out. Enter the access key to lock in.";
const GRANTED_SPEECH = "Access granted. Welcome in, Sepiol.";

// Boot lines that type/slide in on the locked screen.
const LINES: Array<{ label: string; value: string }> = [
  { label: "SYSTEM", value: "JARVIS online" },
  { label: "OWNER", value: "Sepiol" },
  { label: "STATUS", value: "Locked out — authenticate to lock in" },
];

const lineContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.55, delayChildren: 0.2 } },
};
const lineItem: Variants = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0, transition: { duration: 0.4 } },
};

const ringMask =
  "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))";

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"locked" | "granted">("locked");
  const reduce = useReducedMotion();
  const welcomedRef = useRef(false);
  const finishedRef = useRef(false);

  // Spoken welcome on the first interaction (TTS needs a user gesture).
  const onFirstGesture = () => {
    if (welcomedRef.current) return;
    welcomedRef.current = true;
    unlockAudio();
    sfx.boot();
    speak(WELCOME_SPEECH);
  };

  const finish = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onUnlock();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: key }),
      });
      if (res.ok) {
        // ── Congratulation mode ──
        unlockAudio();
        setPhase("granted");
        sfx.granted();
        speak(GRANTED_SPEECH, finish);
        // safety net if speech is muted/blocked: reveal anyway
        window.setTimeout(finish, 3400);
      } else if (res.status === 401) {
        setError("Access denied.");
        setKey("");
      } else {
        setError("Authentication isn't available right now.");
      }
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      onPointerDown={onFirstGesture}
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0 20px calc(28px + env(safe-area-inset-bottom))",
      }}
    >
      <AmbientVideo />
      <CodeStream accent={phase === "granted" ? GRANTED : ACCENT} />
      <CinematicOverlay />

      {/* green flash on grant */}
      <AnimatePresence>
        {phase === "granted" && !reduce && (
          <motion.div
            key="flash"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.45, 0] }}
            transition={{ duration: 0.9, times: [0, 0.15, 0.7] }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 5,
              pointerEvents: "none",
              background: `radial-gradient(circle at 50% 45%, ${GRANTED}55, transparent 60%)`,
            }}
          />
        )}
      </AnimatePresence>

      <div
        style={{
          flex: 1,
          width: "100%",
          display: "grid",
          placeItems: "center",
          padding: "24px 0",
        }}
      >
        <AnimatePresence mode="wait">
          {phase === "locked" ? (
            <motion.div
              key="locked"
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, filter: "blur(6px)" }}
              transition={SPRING.enter}
              style={{ width: "100%", maxWidth: 380 }}
            >
              <motion.form
                onSubmit={submit}
                animate={reduce ? {} : { y: [0, -7, 0] }}
                transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
                style={cardStyle(ACCENT)}
              >
                {/* rotating glowing border */}
                {!reduce && (
                  <motion.span
                    aria-hidden
                    animate={{ rotate: 360 }}
                    transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: 22,
                      background: `conic-gradient(from 0deg, transparent, ${ACCENT}, #67e8f9, transparent 55%)`,
                      WebkitMask: ringMask,
                      mask: ringMask,
                      zIndex: 0,
                    }}
                  />
                )}
                {/* light sheen sweep */}
                {!reduce && (
                  <motion.span
                    aria-hidden
                    initial={{ x: "-160%" }}
                    animate={{ x: ["-160%", "-160%", "160%"] }}
                    transition={{
                      duration: 6,
                      times: [0, 0.7, 1],
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      width: "55%",
                      background:
                        "linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.18) 50%, transparent 65%)",
                      mixBlendMode: "screen",
                      pointerEvents: "none",
                      zIndex: 2,
                    }}
                  />
                )}
                <div style={{ position: "relative", zIndex: 1 }}>
              <motion.div
                animate={{
                  boxShadow: [
                    `0 0 16px -6px ${ACCENT}`,
                    `0 0 26px -2px ${ACCENT}`,
                    `0 0 16px -6px ${ACCENT}`,
                  ],
                }}
                transition={{ duration: 2.4, repeat: Infinity }}
                style={iconRing(ACCENT)}
              >
                <LockIcon />
              </motion.div>

              <h1 style={titleStyle}>JARVIS</h1>

              <motion.div
                variants={lineContainer}
                initial="hidden"
                animate="show"
                style={{
                  margin: "14px 0 20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                  textAlign: "left",
                }}
              >
                {LINES.map((l) => (
                  <motion.div
                    key={l.label}
                    variants={lineItem}
                    style={{
                      display: "flex",
                      gap: 10,
                      fontSize: 12.5,
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    <span
                      style={{
                        color: ACCENT,
                        minWidth: 58,
                        letterSpacing: "0.1em",
                      }}
                    >
                      {l.label}
                    </span>
                    <span style={{ color: "#cbd5e1" }}>{l.value}</span>
                  </motion.div>
                ))}
              </motion.div>

              <div style={inputRow(error)}>
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="access key"
                  aria-label="Access key"
                  autoFocus
                  autoComplete="off"
                  style={inputStyle}
                />
                <button
                  type="submit"
                  disabled={busy || !key.trim()}
                  aria-label="Lock in"
                  style={{
                    ...btnStyle,
                    background: ACCENT,
                    opacity: busy || !key.trim() ? 0.45 : 1,
                  }}
                >
                  {busy ? "…" : "Lock in"}
                </button>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, x: reduce ? 0 : [0, -7, 7, -4, 4, 0] }}
                  transition={{ duration: 0.4 }}
                  role="alert"
                  style={{
                    marginTop: 14,
                    color: "#f87171",
                    fontSize: 13,
                    letterSpacing: "0.08em",
                  }}
                >
                  {error}
                </motion.div>
              )}
                </div>
              </motion.form>
            </motion.div>
          ) : (
            <motion.div
              key="granted"
              initial={{ opacity: 0, scale: reduce ? 1 : 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={SPRING.enter}
              style={cardStyle(GRANTED)}
            >
              <motion.svg
                viewBox="0 0 52 52"
                width="68"
                height="68"
                style={{ margin: "0 auto 14px", display: "block" }}
                animate={reduce ? {} : { scale: [1, 1.12, 1] }}
                transition={{ delay: 0.7, duration: 0.35, ease: "easeOut" }}
              >
                <motion.circle
                  cx="26"
                  cy="26"
                  r="23"
                  fill="none"
                  stroke={GRANTED}
                  strokeWidth="2"
                  initial={{ pathLength: reduce ? 1 : 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
                <motion.path
                  d="M15 27 l8 8 l14 -16"
                  fill="none"
                  stroke={GRANTED}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: reduce ? 1 : 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ delay: 0.45, duration: 0.4, ease: "easeOut" }}
                />
              </motion.svg>
              <motion.h1
                style={{ ...titleStyle, color: GRANTED }}
                initial={
                  reduce
                    ? { opacity: 0, letterSpacing: "0.16em" }
                    : { letterSpacing: "0.4em", opacity: 0 }
                }
                animate={{ letterSpacing: "0.16em", opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.5 }}
              >
                ACCESS GRANTED
              </motion.h1>
              <p style={{ color: "#cbd5e1", fontSize: 14, marginTop: 10 }}>
                Welcome in, Sepiol.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <section className={styles.gallery}>
        <div className={styles.galleryLabel}>Moments</div>
        <MediaGallery accent={phase === "granted" ? GRANTED : ACCENT} active={false} />
      </section>
    </main>
  );
}

/* ---- styles ---- */
function cardStyle(accent: string): React.CSSProperties {
  return {
    position: "relative",
    overflow: "hidden",
    width: "100%",
    maxWidth: 380,
    padding: "30px 26px",
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "linear-gradient(150deg, rgba(40,52,74,0.34), rgba(11,17,32,0.20))",
    backdropFilter: "blur(18px) saturate(1.25)",
    WebkitBackdropFilter: "blur(18px) saturate(1.25)",
    boxShadow: `0 28px 80px -28px ${accent}, inset 0 1px 0 rgba(255,255,255,0.16)`,
    textAlign: "center",
  };
}
function iconRing(accent: string): React.CSSProperties {
  return {
    width: 46,
    height: 46,
    margin: "0 auto",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    border: `1px solid ${accent}66`,
    color: accent,
  };
}
const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  letterSpacing: "0.14em",
  margin: "16px 0 0",
};
function inputRow(error: string): React.CSSProperties {
  return {
    display: "flex",
    gap: 8,
    alignItems: "center",
    border: `1px solid ${error ? "#f87171" : "#334155"}`,
    borderRadius: 999,
    padding: "6px 6px 6px 16px",
    background: "rgba(7,11,22,0.6)",
    transition: "border-color 0.2s ease",
  };
}
const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "transparent",
  border: "none",
  outline: "none",
  color: "#f8fafc",
  fontSize: 15,
  letterSpacing: "0.18em",
};
const btnStyle: React.CSSProperties = {
  flex: "0 0 auto",
  height: 36,
  padding: "0 16px",
  borderRadius: 999,
  border: "none",
  color: "#0b1120",
  fontSize: 13,
  fontWeight: 600,
};

function LockIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
