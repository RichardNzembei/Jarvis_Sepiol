# Jarvis — Voice Assistant

A voice-first web assistant. Hold the orb, speak, and Claude answers out loud.
It can call tools to fetch real data.

## How it works (the spine)

- **Next.js (App Router) + TypeScript**, deployed on Vercel.
- **Push-to-talk only** — hold the orb (or press Space). No wake word.
- **Voice via the browser Web Speech API** — `SpeechRecognition` for
  speech-to-text and `SpeechSynthesis` for text-to-speech. No external speech
  vendor. Speech never leaves the browser.
- **Brain: Claude** (`claude-opus-4-8`), called only from the server-side API
  route `app/api/chat`. **The `ANTHROPIC_API_KEY` never reaches the browser.**
- **Tools** live in a registry (`lib/tools.ts`). Adding a capability = adding
  one entry there. Nothing else changes. A demo `get_current_time` tool ships
  to prove the tool-calling loop end to end.
- **UI**: framer-motion animated mic orb with idle / listening / thinking /
  speaking states (color-coded), respecting `prefers-reduced-motion`.

## Setup

```bash
cp .env.example .env.local      # then paste your ANTHROPIC_API_KEY
npm install
npm run dev                     # http://localhost:3000
```

Open in **Chrome, Edge, or Safari** — Firefox has speech recognition off by
default and will show an unsupported-browser message.

## Project layout

```
app/
  api/chat/route.ts   server-side Claude call + tool-use loop (holds the key)
  page.tsx            push-to-talk UI, STT/TTS, framer-motion orb
  page.module.css     component styles
  globals.css         design tokens (dark OLED palette)
lib/
  tools.ts            tool registry — add capabilities here
```

## Adding a capability

Add one object to the `tools` array in `lib/tools.ts`: a `definition` (the
JSON-schema Claude sees) and a `handler` (server-side function that runs when
Claude calls it). The API route discovers and dispatches it automatically.
