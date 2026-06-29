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
  // as the agentic loop runs.
  const messages: Anthropic.MessageParam[] = incoming.map((m) => ({
    role: m.role,
    content: m.content,
  }));

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
            system: SYSTEM_PROMPT,
            tools: toolDefinitions,
            messages,
          });

          // Forward spoken text as it generates.
          turn.on("text", (delta) => {
            if (delta) controller.enqueue(encoder.encode(delta));
          });

          const final = await turn.finalMessage();

          if (final.stop_reason !== "tool_use") {
            controller.close(); // final answer fully streamed
            return;
          }

          // Tool turn: record it, run every tool, feed results back, loop.
          messages.push({ role: "assistant", content: final.content });
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type !== "tool_use") continue;
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
