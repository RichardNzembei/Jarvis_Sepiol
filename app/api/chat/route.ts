import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, runTool } from "@/lib/tools";
import { isAuthed } from "@/lib/auth";

// Run on the Node.js runtime so the Anthropic SDK and the API key stay
// server-side. The key is read from the ANTHROPIC_API_KEY env var and NEVER
// sent to the browser.
export const runtime = "nodejs";

// Sonnet 4.6 for the voice loop: meaningfully faster round-trips than Opus
// (latency is felt acutely when spoken aloud) while keeping the persona nuance
// and tool-selection reliability a voice assistant needs. Chosen by Sepiol.
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 512; // replies are 1-3 spoken sentences; a guard, not a floor
const MAX_TOOL_ITERATIONS = 6;

// Short phrases streamed (and therefore spoken) while a slow tool runs, so the
// orb doesn't sit in silent "thinking" through a multi-second IMAP/GitHub call.
// Sentence-final punctuation matters: the client only speaks complete sentences.
const NARRATION: Record<string, string> = {
  get_current_time: "",
  get_review_requests: "Checking your review queue. ",
  list_repositories: "Looking over your repositories. ",
  list_my_issues: "Pulling up your open issues. ",
  list_github_notifications: "Checking your GitHub notifications. ",
  create_github_issue: "Filing that issue now. ",
  get_unread_emails: "Checking your inbox now. ",
  get_recent_emails: "Going through your recent mail. ",
  send_whatsapp: "Sending that message. ",
  search_emails: "Searching your mail. ",
  get_sent_emails: "Checking your sent mail. ",
  get_drafts: "Opening your drafts. ",
  web_search: "Searching the web. ",
  get_now_playing: "Checking what's playing. ",
  control_playback: "", // sub-second action — narration would outlast it
  search_music: "Searching Spotify. ",
  play_music: "Starting the music. ",
  queue_track: "Queuing that up. ",
};

const SYSTEM_PROMPT = [
  "You are JARVIS, Sepiol's personal assistant — modeled on the AI from the films:",
  "composed, articulate, quietly witty, and unfailingly loyal. The user's name is",
  "Sepiol. Address them as 'Sepiol' naturally and occasionally (the way the films use",
  "'sir') — not in every sentence.",
  "",
  "Your replies are spoken aloud by a text-to-speech engine, so write the way people talk:",
  "- Keep answers short — usually one to three sentences.",
  "- Plain spoken sentences only. No markdown, lists, code blocks, emoji, or headings.",
  "- Spell things out the way you'd say them (e.g. 'about 3 and a half', not '3.5').",
  "- If you use a tool, fold the result naturally into your spoken answer.",
  "- When you need a tool, make the tool call with NO spoken text in that turn —",
  "  say everything only after you have the results. (Your reply is streamed to",
  "  speech, so any words before a tool call would be spoken prematurely.)",
  "- Tone: refined and calm with a touch of dry wit. Be proactive — when Sepiol seems",
  "  unsure, offer to walk him through it. Never fawning, never long-winded.",
  "",
  "Tools that WRITE to a service (e.g. creating a GitHub issue) are gated: first state",
  "exactly what you'll do and get Sepiol's explicit 'yes', then call the tool with",
  "confirm=true. Never write without that confirmation, and never delete or destroy anything.",
  "",
  "You can search the web for current information — news, weather, anything after your",
  "training data. Compress what you find into one to three spoken sentences; never read",
  "out URLs, source names, or lists of results.",
  "",
  "You can control Sepiol's Spotify: check what's playing, play, pause, skip, set",
  "volume, search, and queue music. Refer to music by name — never read URIs or IDs",
  "aloud. If no device is active, say which devices are available and ask where to play.",
].join("\n");

type IncomingMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  // Gate: only unlocked sessions may talk to Claude.
  if (!isAuthed(req)) {
    return Response.json(
      { error: "Unauthorized. Unlock with the access key first." },
      { status: 401 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Server is missing ANTHROPIC_API_KEY." },
      { status: 500 },
    );
  }

  let body: { messages?: IncomingMessage[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const incoming = body.messages;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return Response.json(
      { error: "Body must include a non-empty `messages` array." },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });

  // Build the working conversation. We append assistant turns and tool results
  // as the agentic loop runs. The last incoming message carries a cache
  // breakpoint so the whole prior conversation is a stable, reusable prefix
  // across turns and across the tool-loop iterations below.
  const messages: Anthropic.MessageParam[] = incoming.map((m, idx) => ({
    role: m.role,
    content:
      idx === incoming.length - 1
        ? [
            {
              type: "text" as const,
              text: m.content,
              cache_control: { type: "ephemeral" as const },
            },
          ]
        : m.content,
  }));

  // Client tools (executed here via runTool) + Anthropic's server-side web
  // search, which runs on their end mid-turn and needs no handler.
  const tools: Anthropic.ToolUnion[] = [
    ...toolDefinitions,
    { type: "web_search_20260209", name: "web_search", max_uses: 3 },
  ];

  // Stream the spoken reply so the browser can begin speaking the first
  // sentence while the rest is still being generated. The tool-use turns run
  // server-side and (per the system prompt) emit no text; only the final
  // answer turn streams text to the client as plain UTF-8 deltas.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          const turn = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            // Block form so the system prompt takes a cache breakpoint: tools +
            // system render before messages, so this one marker caches both.
            system: [
              {
                type: "text",
                text: SYSTEM_PROMPT,
                cache_control: { type: "ephemeral" },
              },
            ],
            tools,
            messages,
          });

          // Forward spoken text as it generates.
          turn.on("text", (delta) => {
            if (delta) controller.enqueue(encoder.encode(delta));
          });

          const final = await turn.finalMessage();

          // Token/cache telemetry only — never message content.
          console.log("[/api/chat]", {
            stop: final.stop_reason,
            input: final.usage.input_tokens,
            cacheRead: final.usage.cache_read_input_tokens,
            cacheWrite: final.usage.cache_creation_input_tokens,
          });

          // Server-side tools (web search) can pause a long turn; hand the
          // partial turn back and continue where it left off.
          if (final.stop_reason === "pause_turn") {
            messages.push({ role: "assistant", content: final.content });
            continue;
          }

          if (final.stop_reason !== "tool_use") {
            controller.close(); // final answer fully streamed
            return;
          }

          // Tool turn: record it, run every tool, feed results back, loop.
          messages.push({ role: "assistant", content: final.content });
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type !== "tool_use") continue;
            // Narrate the slow part: stream a short phrase the client speaks
            // while the tool actually runs.
            const phrase = NARRATION[block.name];
            if (phrase) controller.enqueue(encoder.encode(phrase));
            const result = await runTool(
              block.name,
              block.input as Record<string, unknown>,
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: result,
            });
          }
          messages.push({ role: "user", content: toolResults });
        }
        controller.enqueue(
          encoder.encode("I couldn't quite work that one through, Sepiol."),
        );
        controller.close();
      } catch (err) {
        console.error("[/api/chat]", err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no", // don't let a proxy buffer the stream
    },
  });
}
