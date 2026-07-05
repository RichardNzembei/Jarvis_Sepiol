"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../page.module.css";

/**
 * Diegetic corner telemetry — the whisper-quiet chrome that sells "operating
 * system, not webpage". Four fixed corners of 10px monospace at low opacity,
 * tinted by the state accent. Pointer-events: none; hidden below 920px (the
 * header owns the top edge on narrow screens); 1s tick pauses with the tab.
 */

type Props = {
  accent: string;
  mode: string; // STANDBY | INTAKE | PROCESS | OUTPUT | FAULT
  voiceName: string;
  sttArmed: boolean;
  rtt: number | null; // last time-to-first-byte, ms
  chars: number; // chars streamed in the last reply
  paused?: boolean;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default function HudChrome({
  accent,
  mode,
  voiceName,
  sttArmed,
  rtt,
  chars,
  paused,
}: Props) {
  const bootAtRef = useRef<number>(Date.now());
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [paused]);

  const up = Math.max(0, Math.floor((now.getTime() - bootAtRef.current) / 1000));
  const uptime = `T+${pad(Math.floor(up / 3600))}:${pad(Math.floor((up % 3600) / 60))}:${pad(up % 60)}`;

  const corner = (
    pos: React.CSSProperties,
    bracket: React.CSSProperties,
    lines: string[],
    align: "left" | "right",
  ) => (
    <div className={styles.hudCorner} style={{ ...pos, textAlign: align }}>
      <span className={styles.hudBracket} style={bracket} />
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );

  return (
    <div aria-hidden className={styles.hud} style={{ color: accent }}>
      {corner(
        { top: 14, left: 16 },
        { top: 0, left: -6, borderTop: "1px solid", borderLeft: "1px solid" },
        [`JARVIS // SONNET-4.6`, `MODE: ${mode}`, uptime],
        "left",
      )}
      {corner(
        { top: 14, right: 16 },
        { top: 0, right: -6, borderTop: "1px solid", borderRight: "1px solid" },
        [
          now.toLocaleTimeString([], { hour12: false }),
          now
            .toLocaleDateString([], { year: "numeric", month: "short", day: "2-digit" })
            .toUpperCase(),
        ],
        "right",
      )}
      {corner(
        { bottom: 14, left: 16 },
        { bottom: 0, left: -6, borderBottom: "1px solid", borderLeft: "1px solid" },
        [`VOICE: ${voiceName || "—"}`, `STT: ${sttArmed ? "ARMED" : "MANUAL"}`],
        "left",
      )}
      {corner(
        { bottom: 14, right: 16 },
        { bottom: 0, right: -6, borderBottom: "1px solid", borderRight: "1px solid" },
        [`RTT: ${rtt == null ? "——" : `${rtt}MS`}`, `STREAM: ${chars} CH`],
        "right",
      )}
    </div>
  );
}
