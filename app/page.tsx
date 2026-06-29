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
import LockScreen from "./components/LockScreen";
import CinematicOverlay from "./components/CinematicOverlay";
import MediaGallery from "./components/MediaGallery";
import Sidebar from "./components/Sidebar";
import { sfx, unlock as unlockAudio, setMuted } from "@/lib/sound";
import { SPRING, TAP, DUR } from "@/lib/motion";

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
  const [greeting, setGreeting] = useState("");
  const [muted, setMutedState] = useState(false);
  // null = still checking the real session; true/false = server's answer.
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [bgHidden, setBgHidden] = useState(false);
  const [wakeOn, setWakeOn] = useState(false); // "hey Jarvis" listener armed?

  useEffect(() => {
    const onVis = () => setBgHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setUnlocked(!!d.authed);
      })
      .catch(() => {
        if (!cancelled) setUnlocked(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUnlock = useCallback(() => setUnlocked(true), []);

  useEffect(() => {
    const m = window.localStorage.getItem("jarvis-muted") === "1";
    setMuted(m);
    setMutedState(m);
  }, []);

  // Time-aware greeting for Sepiol + pick the most JARVIS-like (British) voice.
  useEffect(() => {
    const h = new Date().getHours();
    const part =
      h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    const g = `${part}, Sepiol. All systems are online. Hold the orb whenever you'd like to speak.`;
    greetingRef.current = g;
    setGreeting(g);

    const synth = window.speechSynthesis;
    if (!synth) return;
    const pickVoice = () => {
      const voices = synth.getVoices();
      if (!voices.length) return;
      const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
      const pool = en.length ? en : voices;
      // Score: LOCAL voices first — Chrome's remote "Google" voices play over
      // the network and fail SILENTLY (audio just never comes out) while local
      // OS voices are reliable. Then prefer a British male timbre for JARVIS.
      const score = (v: SpeechSynthesisVoice) => {
        let s = 0;
        if (v.localService) s += 100;
        if (/^en-GB/i.test(v.lang)) s += 40;
        if (v.name === "Daniel") s += 30;
        if (/daniel|arthur|george|oliver|male/i.test(v.name)) s += 12;
        return s;
      };
      const best = [...pool].sort((a, b) => score(b) - score(a))[0];
      if (best) voiceRef.current = best;
    };
    pickVoice();
    synth.addEventListener?.("voiceschanged", pickVoice);
    return () => synth.removeEventListener?.("voiceschanged", pickVoice);
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
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const greetingRef = useRef("");
  const greetedRef = useRef(false);

  // "Hey Jarvis" wake listener — a SECOND, continuous recognizer that only
  // runs while idle and armed. It is force-stopped whenever JARVIS is
  // listening/thinking/speaking so it never fights the command recognizer or
  // transcribes JARVIS's own voice.
  const wakeRecRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeOnRef = useRef(false); // mirror of `wakeOn` for use in listeners
  const wakeShouldRunRef = useRef(false); // is the wake recognizer supposed to be live right now?
  const handoffRef = useRef(false); // mid wake→command handoff (suppresses re-arm)
  const wakeFailsRef = useRef(0); // consecutive STT network failures
  const onWakeRef = useRef<() => void>(() => {});

  // Chrome reliability: it pauses long/queued speech (~15s bug) and sometimes
  // never starts a queued utterance after cancel(). A periodic resume() keeps
  // speech flowing; the beat auto-stops once nothing is speaking or pending.
  const ttsBeatRef = useRef<number | null>(null);
  const startTtsBeat = useCallback(() => {
    if (ttsBeatRef.current != null) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    ttsBeatRef.current = window.setInterval(() => {
      if (synth.speaking || synth.pending) {
        synth.resume();
      } else if (ttsBeatRef.current != null) {
        clearInterval(ttsBeatRef.current);
        ttsBeatRef.current = null;
      }
    }, 250);
  }, []);

  useEffect(
    () => () => {
      if (ttsBeatRef.current != null) clearInterval(ttsBeatRef.current);
    },
    [],
  );

  /* ---- speak (TTS) ---- */
  const speak = useCallback((text: string, onDone?: () => void) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      setStatus("idle");
      onDone?.();
      return;
    }
    synth.cancel();
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      setStatus("idle");
      onDone?.();
      return;
    }
    setStatus("speaking");
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      if (voiceRef.current) u.voice = voiceRef.current;
      u.rate = 1.0;
      u.pitch = 0.92; // a touch lower — measured, JARVIS-like
      if (i === chunks.length - 1) {
        u.onend = () => {
          setStatus("idle");
          onDone?.();
        };
        u.onerror = () => {
          setStatus("idle");
          onDone?.();
        };
      }
      synth.speak(u);
    });
    synth.resume(); // Chrome sometimes leaves speech paused after cancel(); unstick it
    startTtsBeat();
  }, [startTtsBeat]);

  // Prime speechSynthesis inside a user gesture. Chrome only plays speech once
  // it has been invoked under a gesture in the session — after that, even
  // delayed speak() calls (e.g. a reply that streams in 6s later) are allowed.
  // The streamed-reply path can fire long after the click, so EVERY send
  // gesture (type, quick-action, voice) must prime first or the reply is silent.
  const primeTTS = useCallback(() => {
    if (ttsUnlockedRef.current) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0;
    synth.speak(warm);
    synth.resume();
    ttsUnlockedRef.current = true;
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
      // Clear any prior/greeting speech NOW, at send time — not right before
      // the reply speaks. cancel() immediately followed by speak() is a known
      // Chrome bug that leaves the utterance stuck (speaking=true, no audio).
      window.speechSynthesis?.cancel();

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
        if (res.status === 401) {
          setUnlocked(false);
          throw new Error("Session locked. Enter the access key again.");
        }
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "Request failed");
        }

        // Streamed reply: speak each sentence the moment it finishes arriving,
        // so JARVIS starts talking before the whole answer is generated. Stay
        // "thinking" through the silent tool-call turns; flip to "speaking" on
        // the first spoken word; back to "idle" when the last utterance ends.
        // (No cancel() here — it was moved to send-time to avoid the Chrome
        // cancel-then-speak stall.)
        const synth = window.speechSynthesis;

        let queued = 0;
        let ended = 0;
        let streamDone = false;
        let everSpoke = false;
        const maybeIdle = () => {
          if (streamDone && ended >= queued) setStatus("idle");
        };
        const speakChunk = (txt: string) => {
          const t = txt.trim();
          if (!synth || !t) return;
          const u = new SpeechSynthesisUtterance(t);
          if (voiceRef.current) u.voice = voiceRef.current;
          u.rate = 1.0;
          u.pitch = 0.92;
          u.onend = () => {
            ended++;
            maybeIdle();
          };
          u.onerror = (e) => {
            ended++;
            // Surface a real speech failure so it's visible, not silent. Ignore
            // the benign ones (we interrupt/cancel on purpose during barge-in).
            const err = (e as SpeechSynthesisErrorEvent).error;
            if (err && err !== "interrupted" && err !== "canceled") {
              setError(`Voice playback failed (${err}). Reply shown above.`);
            }
            maybeIdle();
          };
          queued++;
          if (!everSpoke) {
            everSpoke = true;
            sfx.reply();
            setStatus("speaking");
            // A browser with no installed voices can't speak at all — say so.
            if (synth.getVoices().length === 0) {
              setError("No speech voices available in this browser — reply shown above.");
            }
          }
          synth.speak(u);
          synth.resume(); // Chrome unstick — utterances can queue silently otherwise
          startTtsBeat();
        };

        let full = "";
        let spoken = 0; // chars already handed to TTS
        const drain = () => {
          const tail = full.slice(spoken);
          const re = /[^.!?]*[.!?]+/g; // only complete sentences
          let consumed = 0;
          while (re.exec(tail) !== null) consumed = re.lastIndex;
          if (consumed > 0) {
            speakChunk(tail.slice(0, consumed));
            spoken += consumed;
          }
        };

        if (res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            full += decoder.decode(value, { stream: true });
            setReply(full);
            drain();
          }
          full += decoder.decode(); // flush trailing bytes
        } else {
          full = await res.text(); // no ReadableStream — read it whole
        }

        setReply(full);
        const restTail = full.slice(spoken).trim();
        if (restTail) speakChunk(restTail); // final partial sentence

        messagesRef.current = [
          ...history,
          { role: "assistant", content: full },
        ];

        streamDone = true;
        if (queued === 0) setStatus("idle");
        else maybeIdle();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        sfx.error();
        setStatus("error");
      }
    },
    [speak, startTtsBeat],
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

    // --- "Hey Jarvis" wake recognizer (continuous, armed on demand) ---
    const wake = new SRClass();
    wake.continuous = true;
    wake.interimResults = true;
    wake.lang = "en-US";

    const matchesWake = (raw: string) => {
      const t = raw.toLowerCase().replace(/[^a-z\s]/g, " ");
      return (
        /\bhey\s+jarvis\b/.test(t) ||
        (/\bdaddy\b/.test(t) && /\bhome\b/.test(t)) ||
        (/\bjarvis\b/.test(t) && /\bhome\b/.test(t))
      );
    };

    wake.onresult = (e) => {
      wakeFailsRef.current = 0; // service is reachable
      let heard = "";
      for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript + " ";
      if (matchesWake(heard)) onWakeRef.current();
    };

    wake.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wakeOnRef.current = false;
        wakeShouldRunRef.current = false;
        setWakeOn(false);
        setError("Microphone access denied — couldn't arm the wake word.");
        return;
      }
      if (e.error === "network") {
        wakeFailsRef.current += 1;
        if (wakeFailsRef.current > 6) {
          wakeOnRef.current = false;
          wakeShouldRunRef.current = false;
          setWakeOn(false);
          setError(
            "Wake word disarmed — the speech service kept failing. Chrome streams audio to Google's servers; check your connection, then re-arm.",
          );
        }
      }
      // no-speech / aborted / audio-capture: ignore — onend will restart.
    };

    wake.onend = () => {
      // Continuous recognition still stops periodically; keep it alive while armed.
      if (wakeShouldRunRef.current) {
        setTimeout(() => {
          if (wakeShouldRunRef.current) {
            try {
              wake.start();
            } catch {
              /* already running */
            }
          }
        }, 350);
      }
    };

    wakeRecRef.current = wake;

    return () => {
      recognition.abort();
      wakeShouldRunRef.current = false;
      try {
        wake.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  /* ---- push-to-talk controls ---- */
  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || listeningRef.current) return;

    // Unlock audio within this gesture (browsers require it).
    unlockAudio();
    primeTTS();

    // First hold wakes JARVIS: boot sound + spoken greeting, no listening yet.
    if (!greetedRef.current) {
      greetedRef.current = true;
      sfx.boot();
      speak(greetingRef.current);
      return;
    }

    // Barge-in: stop any current speech.
    sfx.press();
    window.speechSynthesis?.cancel();

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
  }, [speak, primeTTS]);

  const stopListening = useCallback(() => {
    if (!listeningRef.current) return;
    recognitionRef.current?.stop();
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setStatus("idle");
  }, []);

  /* ---- wake word: "hey Jarvis" → confirm → listen ---- */
  const onWake = useCallback(() => {
    if (handoffRef.current) return; // already handling a wake
    handoffRef.current = true;
    wakeShouldRunRef.current = false;
    try {
      wakeRecRef.current?.stop(); // don't transcribe our own confirmation
    } catch {
      /* ignore */
    }
    unlockAudio();
    ttsUnlockedRef.current = true;
    greetedRef.current = true; // skip the "first hold greets" path
    sfx.granted();
    setError("");
    setReply("");
    setTranscript("");
    speak("Sepiol, under your command.", () => {
      startListening(); // open the mic for the actual command
      handoffRef.current = false;
    });
  }, [speak, startListening]);

  useEffect(() => {
    onWakeRef.current = onWake;
  }, [onWake]);

  const toggleWake = useCallback(() => {
    if (!recognitionRef.current) return; // STT unsupported
    unlockAudio(); // this click is the gesture that lets the mic + audio work
    primeTTS(); // prime speech under the gesture so the wake reply can speak later
    wakeFailsRef.current = 0;
    setWakeOn((prev) => {
      const next = !prev;
      wakeOnRef.current = next;
      return next;
    });
  }, [primeTTS]);

  // Run the wake recognizer ONLY while armed and idle — never during a command
  // or while JARVIS is speaking (or it would transcribe his own voice).
  useEffect(() => {
    const wake = wakeRecRef.current;
    if (!wake) return;
    const shouldRun = wakeOn && status === "idle" && !handoffRef.current;
    wakeShouldRunRef.current = shouldRun;
    try {
      if (shouldRun) wake.start();
      else wake.stop();
    } catch {
      /* start() throws if already running; stop() if already stopped */
    }
  }, [wakeOn, status]);

  // Typed fallback — works on any browser/network when voice STT is unavailable.
  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text || status === "thinking") return;
    unlockAudio(); // gesture → lets sfx play
    primeTTS(); // gesture → lets the (later-streaming) spoken reply play
    setError("");
    setReply("");
    setTranscript(text);
    setTyped("");
    sendMessage(text);
  };

  // Right-sidebar quick actions → fire the matching tool through Jarvis.
  const handleQuickAction = useCallback(
    (key: "agent" | "gmail" | "github") => {
      if (status === "thinking") return;
      const map = {
        agent: {
          label: "Who are you, Jarvis?",
          prompt: "In one or two sentences, introduce yourself and what you can do for me.",
        },
        gmail: {
          label: "Check my email",
          prompt: "Do I have any unread emails? Keep it brief.",
        },
        github: {
          label: "What's on GitHub?",
          prompt:
            "What pull requests need my review and what issues are assigned to me? Be brief.",
        },
      }[key];
      unlockAudio();
      primeTTS(); // gesture → lets the streamed spoken reply play
      setError("");
      setReply("");
      setTranscript(map.label);
      sendMessage(map.prompt);
    },
    [sendMessage, status, primeTTS],
  );

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

  /* ---- render: checking the session (avoids any unlocked/lock flash) ---- */
  if (unlocked === null) return <main className={styles.shell} />;

  /* ---- render: locked (auth gate) ---- */
  if (!unlocked) return <LockScreen onUnlock={handleUnlock} />;

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
      <Sidebar
        accent={accent}
        onAction={handleQuickAction}
        disabled={status === "thinking"}
        paused={bgHidden}
      />

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
            transition={{ duration: DUR.fast }}
          >
            {STATUS_LABEL[status]}
          </motion.div>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={toggleWake}
            aria-label={
              wakeOn ? 'Disarm wake word' : 'Arm wake word — say "hey Jarvis"'
            }
            aria-pressed={wakeOn}
            title={
              wakeOn
                ? 'Listening for "hey Jarvis" — click to disarm'
                : 'Arm "hey Jarvis" wake word (mic stays on)'
            }
            style={
              wakeOn
                ? { color: accent, borderColor: accent, boxShadow: `0 0 0 1px ${accent}55` }
                : undefined
            }
          >
            <WakeIcon active={wakeOn} />
          </button>
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
          animate={reduceMotion || bgHidden ? { rotate: 0 } : { rotate: [-6, 6] }}
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
                    exit={{ opacity: 0, transition: { duration: 0.3 } }}
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

          {/* thinking spinner — eases in/out instead of snapping */}
          <AnimatePresence>
            {status === "thinking" && (
              <motion.div
                key="spinner"
                className={styles.spinner}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={
                  reduceMotion
                    ? { opacity: 1, scale: 1 }
                    : { opacity: 1, scale: 1, rotate: 360 }
                }
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{
                  opacity: { duration: 0.2 },
                  scale: { duration: 0.2 },
                  rotate: { duration: 1.1, repeat: Infinity, ease: "linear" },
                }}
              />
            )}
          </AnimatePresence>

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
            whileTap={{ scale: TAP }}
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
          {greeting && !reply && !transcript && status !== "thinking" && (
            <motion.div
              key="greeting"
              className={`${styles.bubble} ${styles.bubbleAssistant}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={SPRING.enter}
            >
              <div className={styles.bubbleLabel}>Jarvis</div>
              <div className={styles.bubbleText}>{greeting}</div>
            </motion.div>
          )}

          {transcript && (
            <motion.div
              key="user"
              className={`${styles.bubble} ${styles.bubbleUser}`}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={SPRING.enter}
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
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8 }}
              transition={SPRING.enter}
            >
              <div className={styles.bubbleLabel}>Jarvis</div>
              <span className={styles.thinkingDots} aria-label="Thinking">
                {[0, 1, 2].map((d) => (
                  <motion.span
                    key={d}
                    animate={reduceMotion ? {} : { opacity: [0.3, 1, 0.3] }}
                    transition={{
                      duration: 0.9,
                      repeat: Infinity,
                      delay: d * 0.18,
                      ease: "easeInOut",
                    }}
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
              transition={SPRING.enter}
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
          paused={bgHidden}
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

// Wake-word toggle: a "listening signal" — a centre dot with radiating arcs.
// Filled centre when armed.
function WakeIcon({ active }: { active?: boolean }) {
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
      <circle
        cx="12"
        cy="12"
        r={active ? 2.6 : 2}
        fill={active ? "currentColor" : "none"}
        stroke={active ? "none" : "currentColor"}
      />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4" />
      <path d="M16.2 16.2a6 6 0 0 0 0-8.4" />
      <path d="M5 5a10 10 0 0 0 0 14" />
      <path d="M19 19a10 10 0 0 0 0-14" />
    </svg>
  );
}
