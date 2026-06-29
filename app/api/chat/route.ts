import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, runTool } from "@/lib/tools";
import { isAuthed } from "@/lib/auth";

// Run on the Node.js runtime so the Anthropic SDK and the API key stay
// server-side. The key is read from the ANTHROPIC_API_KEY env var and NEVER
// sent to the browser.
export const runtime = "nodejs";

const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 1024;
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

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: toolDefinitions,
        messages,
      });

      if (response.stop_reason !== "tool_use") {
        // Done — gather the spoken text from all text blocks.
        const reply = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join(" ")
          .trim();
        return Response.json({ reply });
      }

      // Claude wants to call one or more tools. Record its turn, run them,
      // and feed every result back in a single user message.
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
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

    return Response.json(
      { error: "Tool loop did not converge. Try rephrasing." },
      { status: 500 },
    );
  } catch (err) {
    console.error("[/api/chat]", err);
    const message =
      err instanceof Anthropic.APIError
        ? `Claude API error (${err.status ?? "?"}).`
        : "Something went wrong talking to Claude.";
    return Response.json({ error: message }, { status: 502 });
  }
}
