"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import styles from "./page.module.css";
import AmbientVideo from "./components/AmbientVideo";
import CodeStream from "./components/CodeStream";
import CinematicOverlay from "./components/CinematicOverlay";
import MediaGallery from "./components/MediaGallery";
import { sfx, unlock as unlockAudio, setMuted } from "@/lib/sound";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Status = "idle" | "listening" | "thinking" | "speaking" | "error";
type ChatMessage = { role: "user" | "assistant"; content: string };

// The Web Speech API is not in the standard TS DOM lib — minimal shape.
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const ACCENT: Record<Status, string> = {
  idle: "#818cf8",
  listening: "#22d3ee",
  thinking: "#fbbf24",
  speaking: "#34d399",
  error: "#f87171",
};

const STATUS_LABEL: Record<Status, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Error",
};

/**
 * Chrome cuts off SpeechSynthesis utterances over ~200 chars. Split a reply
 * into sentence-sized chunks (≤ 200 chars) so they can be queued reliably.
 */
function chunkText(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [text];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    let s = sentence.trim();
    if (!s) continue;
    while (s.length > 200) {
      let cut = s.lastIndexOf(" ", 200);
      if (cut <= 0) cut = 200;
      chunks.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (s) chunks.push(s);
  }
  return chunks;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function Home() {
  const reduceMotion = useReducedMotion();

  // null = still detecting (avoids SSR/client flash), true/false = result
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    const m = window.localStorage.getItem("jarvis-muted") === "1";
    setMuted(m);
    setMutedState(m);
  }, []);

  const toggleMute = useCallback(() => {
    setMutedState((prev) => {
      const next = !prev;
      setMuted(next);
      if (!next) unlockAudio();
      return next;
    });
  }, []);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const listeningRef = useRef(false);
  const ttsUnlockedRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const sendRef = useRef<(text: string) => void>(() => {});

  /* ---- speak (TTS) ---- */
  const speak = useCallback((text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      setStatus("idle");
      return;
    }
    synth.cancel();
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      setStatus("idle");
      return;
    }
    setStatus("speaking");
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.rate = 1.02;
      u.pitch = 1;
      if (i === chunks.length - 1) {
        u.onend = () => setStatus("idle");
        u.onerror = () => setStatus("idle");
      }
      synth.speak(u);
    });
  }, []);

  /* ---- send to Claude ---- */
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        setStatus("idle");
        return;
      }
      setError("");
      sfx.send();
      setStatus("thinking");

      const history: ChatMessage[] = [
        ...messagesRef.current,
        { role: "user", content: trimmed },
      ];
      messagesRef.current = history;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Request failed");

        const answer: string = data.reply || "";
        messagesRef.current = [
          ...history,
          { role: "assistant", content: answer },
        ];
        setReply(answer);
        sfx.reply();
        speak(answer);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        sfx.error();
        setStatus("error");
      }
    },
    [speak],
  );

  useEffect(() => {
    sendRef.current = sendMessage;
  }, [sendMessage]);

  /* ---- detect support + build recognizer (once) ---- */
  useEffect(() => {
    const SRClass =
      (
        window as unknown as {
          SpeechRecognition?: new () => SpeechRecognitionLike;
        }
      ).SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        }
      ).webkitSpeechRecognition;

    if (!SRClass || !window.speechSynthesis) {
      setSupported(false);
      return;
    }
    setSupported(true);

    const recognition = new SRClass();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0].transcript;
        if (r.isFinal) finalTranscriptRef.current += txt;
        else interim += txt;
      }
      setTranscript((finalTranscriptRef.current + interim).trim());
    };

    recognition.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      let message: string;
      switch (e.error) {
        case "not-allowed":
        case "service-not-allowed":
          message =
            "Microphone access denied. Enable it for this site in your browser settings.";
          break;
        case "network":
          message =
            "Couldn't reach the speech service. Chrome transcribes via Google's servers — check your internet, turn off any VPN/proxy, and use Google Chrome. Then try again.";
          break;
        default:
          message = `Speech recognition error: ${e.error}`;
      }
      setError(message);
      setStatus("error");
    };

    recognition.onend = () => {
      listeningRef.current = false;
      const text = finalTranscriptRef.current.trim();
      if (text) sendRef.current(text);
      else setStatus((s) => (s === "listening" ? "idle" : s));
    };

    recognitionRef.current = recognition;
    return () => recognition.abort();
  }, []);

  /* ---- push-to-talk controls ---- */
  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || listeningRef.current) return;

    // Barge-in: stop any current speech and unlock audio within this gesture.
    unlockAudio();
    sfx.press();
    window.speechSynthesis?.cancel();
    if (!ttsUnlockedRef.current) {
      const warm = new SpeechSynthesisUtterance(" ");
      warm.volume = 0;
      window.speechSynthesis?.speak(warm);
      ttsUnlockedRef.current = true;
    }

    setError("");
    setReply("");
    setTranscript("");
    finalTranscriptRef.current = "";
    listeningRef.current = true;
    setStatus("listening");
    try {
      recognition.start();
    } catch {
      listeningRef.current = false;
      setStatus("idle");
    }
  }, []);

  const stopListening = useCallback(() => {
    if (!listeningRef.current) return;
    recognitionRef.current?.stop();
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setStatus("idle");
  }, []);

  // Typed fallback — works on any browser/network when voice STT is unavailable.
  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text || status === "thinking") return;
    unlockAudio(); // gesture → lets the spoken reply play
    setError("");
    setReply("");
    setTranscript(text);
    setTyped("");
    sendMessage(text);
  };

  /* ---- render: detecting ---- */
  if (supported === null) return <main className={styles.shell} />;

  /* ---- render: unsupported browser ---- */
  if (supported === false) {
    return (
      <main className={styles.fallback}>
        <motion.div
          className={styles.fallbackCard}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1>Voice isn&apos;t supported here</h1>
          <p>
            Jarvis uses your browser&apos;s built-in speech recognition, which
            this browser doesn&apos;t provide. Please open it in one of these:
          </p>
          <div className={styles.fallbackBadges}>
            <span>Chrome</span>
            <span>Edge</span>
            <span>Safari</span>
          </div>
        </motion.div>
      </main>
    );
  }

  /* ---- render: main app ---- */
  const accent = ACCENT[status];
  const showRings = status === "listening" || status === "speaking";

  const orbVariants: Variants = reduceMotion
    ? { idle: {}, listening: {}, thinking: {}, speaking: {}, error: {} }
    : {
        idle: {
          scale: [1, 1.04, 1],
          transition: { duration: 4, repeat: Infinity, ease: "easeInOut" },
        },
        listening: {
          scale: [1, 1.08, 1],
          transition: { duration: 1.1, repeat: Infinity, ease: "easeInOut" },
        },
        thinking: { scale: 1 },
        speaking: {
          scale: [1, 1.06, 1],
          transition: { duration: 0.7, repeat: Infinity, ease: "easeInOut" },
        },
        error: { scale: 1 },
      };

  return (
    <main className={styles.shell}>
      <AmbientVideo />
      <CodeStream accent={accent} />
      <CinematicOverlay />

      <header className={styles.header}>
        <div className={styles.brand} style={{ color: accent }}>
          <span className={styles.brandDot} />
          <span style={{ color: "var(--fg)" }}>JARVIS</span>
        </div>
        <div className={styles.headerRight}>
          <motion.div
            className={styles.statusPill}
            key={status}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0, color: accent }}
            transition={{ duration: 0.25 }}
          >
            {STATUS_LABEL[status]}
          </motion.div>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={toggleMute}
            aria-label={muted ? "Unmute sounds" : "Mute sounds"}
            aria-pressed={muted}
          >
            {muted ? <SpeakerOffIcon /> : <SpeakerOnIcon />}
          </button>
        </div>
      </header>

      <section className={styles.stage}>
        <motion.div
          className={styles.pendulum}
          animate={reduceMotion ? { rotate: 0 } : { rotate: [-6, 6] }}
          transition={
            reduceMotion
              ? undefined
              : {
                  duration: 2.8,
                  repeat: Infinity,
                  repeatType: "mirror",
                  ease: "easeInOut",
                }
          }
        >
          <span className={styles.mount} />
          <span className={styles.string} />
          <div
            className={styles.orbWrap}
            style={{ color: accent }}
            role="presentation"
          >
          {/* expanding rings while listening / speaking */}
          {!reduceMotion && (
            <AnimatePresence>
              {showRings &&
                [0, 0.5, 1].map((delay) => (
                  <motion.span
                    key={delay}
                    className={styles.ring}
                    initial={{ scale: 0.62, opacity: 0.7 }}
                    animate={{ scale: 1.7, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: 1.8,
                      repeat: Infinity,
                      delay,
                      ease: "easeOut",
                    }}
                  />
                ))}
            </AnimatePresence>
          )}

          {/* thinking spinner */}
          {status === "thinking" && (
            <motion.div
              className={styles.spinner}
              animate={reduceMotion ? {} : { rotate: 360 }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
            />
          )}

          {/* the orb button */}
          <motion.button
            type="button"
            className={styles.orb}
            aria-label="Press and hold to talk"
            aria-pressed={status === "listening"}
            style={{
              background: "#000",
              boxShadow: "0 12px 34px -12px rgba(0,0,0,0.85)",
            }}
            variants={orbVariants}
            animate={status}
            whileTap={{ scale: 0.94 }}
            onPointerDown={(e) => {
              e.preventDefault();
              startListening();
            }}
            onPointerUp={stopListening}
            onPointerLeave={stopListening}
            onPointerCancel={stopListening}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                e.preventDefault();
                startListening();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                stopListening();
              }
            }}
          >
            <MicIcon className={styles.orbIcon} />
          </motion.button>
          </div>
        </motion.div>

        <form className={styles.composer} onSubmit={submitTyped}>
          <input
            className={styles.composerInput}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="…or type to Jarvis"
            aria-label="Type a message to Jarvis"
            enterKeyHint="send"
          />
          <button
            type="submit"
            className={styles.composerBtn}
            style={{ background: accent }}
            disabled={!typed.trim() || status === "thinking"}
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        </form>
      </section>

      <div className={styles.feed}>
        <AnimatePresence mode="popLayout">
          {transcript && (
            <motion.div
              key="user"
              className={`${styles.bubble} ${styles.bubbleUser}`}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
            >
              <div className={styles.bubbleLabel}>You</div>
              <div
                className={`${styles.bubbleText} ${
                  status === "listening" ? styles.interim : ""
                }`}
              >
                {transcript}
              </div>
            </motion.div>
          )}

          {status === "thinking" && (
            <motion.div
              key="thinking"
              className={`${styles.bubble} ${styles.bubbleAssistant}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <div className={styles.bubbleLabel}>Jarvis</div>
              <span className={styles.thinkingDots} aria-label="Thinking">
                {[0, 0.2, 0.4].map((d) => (
                  <motion.span
                    key={d}
                    animate={reduceMotion ? {} : { opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: d }}
                  />
                ))}
              </span>
            </motion.div>
          )}

          {reply && status !== "thinking" && (
            <motion.div
              key="reply"
              className={`${styles.bubble} ${styles.bubbleAssistant}`}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
            >
              <div className={styles.bubbleLabel}>Jarvis</div>
              <div className={styles.bubbleText}>{reply}</div>
            </motion.div>
          )}

          {error && (
            <motion.div
              key="error"
              className={`${styles.bubble} ${styles.errorBubble}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="alert"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <section className={styles.gallery}>
        <div className={styles.galleryLabel}>Moments</div>
        <MediaGallery
          accent={accent}
          active={status === "listening" || status === "speaking"}
        />
      </section>

      <footer className={styles.footer}>
        {status === "speaking" && (
          <button className={styles.stopBtn} onClick={stopSpeaking}>
            Stop speaking
          </button>
        )}
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Inline mic icon (Lucide-style, no emoji)                            */
/* ------------------------------------------------------------------ */

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#08080a"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 12h14" />
      <path d="M12 5l7 7-7 7" />
    </svg>
  );
}

function SpeakerOnIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function SpeakerOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <line x1="16" y1="9" x2="22" y2="15" />
      <line x1="22" y1="9" x2="16" y2="15" />
    </svg>
  );
}
