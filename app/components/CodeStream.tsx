"use client";

import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Background of real, syntax-highlighted source code scrolling in parallel
 * columns at varying speeds — like a wall of editors. Faint and radially
 * masked behind the orb so foreground text stays readable. Reduced-motion →
 * static, offset columns.
 */

// Real(istic) program code — the kind of thing this app is made of.
const SAMPLE = `// jarvis · speech pipeline
async function listen(): Promise<string> {
  const stream = await navigator.mediaDevices
    .getUserMedia({ audio: true });
  const rec = new SpeechRecognition();
  rec.interimResults = true;
  rec.lang = "en-US";
  return new Promise((resolve) => {
    let final = "";
    rec.onresult = (event) => {
      for (const r of event.results) {
        if (r.isFinal) final += r[0].transcript;
      }
    };
    rec.onend = () => resolve(final.trim());
    rec.start();
  });
}

export async function ask(messages: Message[]) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error("request failed");
  const data = await res.json();
  return data.reply as string;
}

function speak(text: string) {
  const synth = window.speechSynthesis;
  for (const part of chunk(text, 200)) {
    const u = new SpeechSynthesisUtterance(part);
    u.rate = 1.02;
    synth.speak(u);
  }
}

const tools = registry.map((tool) => tool.definition);
while (response.stop_reason === "tool_use") {
  const out = await runTool(call.name, call.input);
  messages.push({ role: "user", content: out });
}
return final;`;

const LINES = SAMPLE.split("\n");
const KEYWORDS =
  /\b(const|let|var|function|return|if|else|for|while|await|async|import|from|export|default|new|type|interface|class|extends|implements|public|private|readonly|try|catch|throw|typeof|in|of|true|false|null|undefined|void|this|as)\b/g;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(line: string, accent: string): string {
  let s = esc(line);
  // strings (quotes survive esc since we only escape & < >)
  s = s.replace(
    /(['"`])(.*?)\1/g,
    (m) => `<span style="color:#86efac">${m}</span>`,
  );
  // trailing/line comments
  s = s.replace(/(\/\/[^<]*)$/, '<span style="color:#5b6b86">$1</span>');
  // keywords
  s = s.replace(KEYWORDS, (m) => `<span style="color:${accent}">${m}</span>`);
  // numbers
  s = s.replace(/\b(\d+)\b/g, '<span style="color:#fbbf24">$1</span>');
  return s;
}

const COLS = 5;

export default function CodeStream({ accent }: { accent: string }) {
  const reduce = useReducedMotion();

  // Pause the scroll when the tab is hidden (battery — no point animating offscreen).
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Build each column's doubled HTML once (rotated for variety).
  const columns = useMemo(() => {
    return Array.from({ length: COLS }, (_, i) => {
      const start = (i * 9) % LINES.length;
      const rotated = LINES.slice(start).concat(LINES.slice(0, start));
      const html = rotated.map((l) => highlight(l, accent)).join("\n");
      return html + "\n" + html; // doubled → seamless -50% loop
    });
  }, [accent]);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -2,
        pointerEvents: "none",
        opacity: 0.34,
        display: "flex",
        justifyContent: "space-around",
        gap: "3vw",
        // Presence: nearer layer parallaxes a touch more than the video.
        translate:
          "calc(var(--gaze-x, 0) * -11px) calc(var(--gaze-y, 0) * -7px)",
        maskImage:
          "radial-gradient(ellipse 62% 58% at 50% 42%, transparent 34%, #000 78%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 62% 58% at 50% 42%, transparent 34%, #000 78%)",
      }}
    >
      {columns.map((html, i) => (
        <div
          key={i}
          style={{ flex: 1, overflow: "hidden", height: "100%" }}
        >
          <div
            className="code-col-inner"
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
              lineHeight: "18px",
              whiteSpace: "pre",
              color: "#cbd5e1",
              animation: reduce
                ? "none"
                : `codeScroll ${30 + i * 8}s linear infinite`,
              animationDelay: reduce ? undefined : `${-i * 6}s`,
              animationPlayState: paused ? "paused" : "running",
              transform: reduce ? `translateY(${-i * 60}px)` : undefined,
              willChange: "transform",
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      ))}
    </div>
  );
}
