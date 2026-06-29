import type Anthropic from "@anthropic-ai/sdk";

/**
 * Tool registry.
 *
 * Adding a capability to Jarvis = adding one entry to this array. Nothing else
 * in the app needs to change: the API route hands `definitions` to Claude and
 * dispatches any tool call back through `run`.
 *
 * Each tool is a definition (what Claude sees) plus a handler (what runs on the
 * server when Claude calls it). Handlers run server-side only — they can safely
 * read env vars, hit internal APIs, etc.
 */
export type Tool = {
  definition: Anthropic.Tool;
  handler: (input: Record<string, unknown>) => Promise<string> | string;
};

const tools: Tool[] = [
  {
    definition: {
      name: "get_current_time",
      description:
        "Get the current date and time. Use this whenever the user asks what " +
        "time or day it is. Returns a human-readable string.",
      input_schema: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description:
              "IANA timezone name, e.g. 'Africa/Nairobi' or 'America/New_York'. " +
              "Omit to use the server's local time.",
          },
        },
        required: [],
      },
    },
    handler: (input) => {
      const timezone =
        typeof input.timezone === "string" ? input.timezone : undefined;
      try {
        const now = new Date();
        const formatted = new Intl.DateTimeFormat("en-US", {
          dateStyle: "full",
          timeStyle: "long",
          timeZone: timezone,
        }).format(now);
        return formatted;
      } catch {
        return `Unknown timezone "${timezone}". Please give a valid IANA timezone name.`;
      }
    },
  },
  {
    definition: {
      name: "get_review_requests",
      description:
        "List the open GitHub pull requests that are waiting for the user's " +
        "review (review requested from them). Use whenever the user asks what " +
        "needs their review, which PRs to review, or about their review queue.",
      input_schema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    handler: async () => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        return "GitHub isn't configured on the server (no GITHUB_TOKEN).";
      }
      const query = "is:open is:pr review-requested:@me";
      const url =
        "https://api.github.com/search/issues?per_page=20&q=" +
        encodeURIComponent(query);
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "jarvis-voice-assistant",
        },
      });
      if (!res.ok) {
        const body = await res.text();
        return `GitHub API error ${res.status}: ${body.slice(0, 300)}`;
      }
      const data: {
        total_count?: number;
        items?: Array<{
          number: number;
          title: string;
          repository_url?: string;
        }>;
      } = await res.json();
      const items = data.items ?? [];
      if (items.length === 0) {
        return "No open pull requests are waiting for your review.";
      }
      const lines = items.map((it) => {
        const repo = it.repository_url?.split("/repos/")[1] ?? "a repo";
        return `#${it.number} "${it.title}" in ${repo}`;
      });
      const n = items.length;
      return `${n} pull request${n === 1 ? "" : "s"} awaiting your review: ${lines.join("; ")}.`;
    },
  },
];

/** Tool definitions to pass to the Anthropic API. */
export const toolDefinitions = tools.map((t) => t.definition);

/** Dispatch a tool call by name. Returns the result string Claude will read. */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) return `Error: no tool named "${name}".`;
  try {
    return await tool.handler(input);
  } catch (err) {
    return `Error running "${name}": ${err instanceof Error ? err.message : String(err)}`;
  }
}
