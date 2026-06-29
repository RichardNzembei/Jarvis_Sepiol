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

/* ------------------------------------------------------------------ */
/* GitHub helpers (read + gated writes, server-side only)              */
/* ------------------------------------------------------------------ */

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "jarvis-voice-assistant",
  };
}

type GhResult = { ok: boolean; status: number; data?: unknown; error?: string };

async function ghRequest(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<GhResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, status: 0, error: "GitHub isn't configured (no GITHUB_TOKEN)." };
  const headers = ghHeaders(token);
  if (init?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`https://api.github.com${path}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200);
    const hint =
      res.status === 403 || res.status === 404
        ? " (the token may lack this permission — broaden its scopes)"
        : "";
    return { ok: false, status: res.status, error: `GitHub API error ${res.status}${hint}: ${text}` };
  }
  return { ok: true, status: res.status, data: await res.json() };
}

/* ------------------------------------------------------------------ */
/* Email helper — read-only Gmail over IMAP (App Password)             */
/* ------------------------------------------------------------------ */

type MailItem = { from: string; to: string; subject: string; date: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
function addr(arr: any[]): string {
  return arr?.[0]?.name || arr?.[0]?.address || "";
}
function fmtMail(msg: any): MailItem {
  const env = msg?.envelope ?? {};
  return {
    from: addr(env.from) || "unknown sender",
    to: addr(env.to) || "unknown recipient",
    subject: env.subject || "(no subject)",
    date: env.date
      ? new Date(env.date).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
      : "",
  };
}

type FetchOpts = {
  mailbox?: string; // literal IMAP path, e.g. "INBOX"
  special?: "\\All" | "\\Sent" | "\\Drafts"; // resolve by special-use (locale-safe)
  unreadOnly?: boolean;
  query?: string; // keyword matched against From / Subject / Body
  limit: number;
};

async function resolveMailbox(client: any, opts: FetchOpts): Promise<string> {
  if (opts.mailbox) return opts.mailbox;
  if (opts.special) {
    const list = await client.list();
    const m = list.find((x: any) => x.specialUse === opts.special);
    if (m?.path) return m.path;
  }
  return "INBOX";
}

/** Read/search any Gmail mailbox over IMAP (read-only). */
async function readMail(
  opts: FetchOpts,
): Promise<{ ok: boolean; error?: string; items?: MailItem[]; total?: number }> {
  const user = process.env.EMAIL_ADDRESS;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass)
    return { ok: false, error: "Email isn't configured (no EMAIL_ADDRESS / GMAIL_APP_PASSWORD)." };

  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    const mailbox = await resolveMailbox(client, opts);
    const lock = await client.getMailboxLock(mailbox);
    const items: MailItem[] = [];
    let total = 0;
    try {
      const box = client.mailbox;
      const exists = box && typeof box !== "boolean" ? box.exists : 0;

      let uids: number[] | null = null;
      if (opts.query) {
        const q = opts.query;
        uids = ((await client.search(
          { or: [{ from: q }, { subject: q }, { body: q }] },
          { uid: true },
        )) || []) as number[];
      } else if (opts.unreadOnly) {
        uids = ((await client.search({ seen: false }, { uid: true })) || []) as number[];
      }

      if (uids) {
        total = uids.length;
        const take = uids.slice(-opts.limit);
        if (take.length) {
          for await (const msg of client.fetch(take, { envelope: true }, { uid: true })) {
            items.push(fmtMail(msg));
          }
        }
      } else {
        total = exists;
        const start = Math.max(1, exists - opts.limit + 1);
        if (exists > 0) {
          for await (const msg of client.fetch(`${start}:*`, { envelope: true })) {
            items.push(fmtMail(msg));
          }
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
    items.reverse(); // newest first
    return { ok: true, items, total };
  } catch (e) {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
    return { ok: false, error: `Email error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
  {
    definition: {
      name: "list_repositories",
      description:
        "List the user's most recently updated GitHub repositories. Use when " +
        "Sepiol asks about his repos, recent projects, or what he's been working on.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const r = await ghRequest("/user/repos?sort=updated&per_page=10");
      if (!r.ok) return r.error!;
      const repos = (r.data as Array<{ full_name: string; private: boolean; description?: string }>) ?? [];
      if (!repos.length) return "No repositories found.";
      return (
        `${repos.length} most-recently-updated repos: ` +
        repos
          .map((x) => `${x.full_name}${x.private ? " (private)" : ""}`)
          .join("; ") +
        "."
      );
    },
  },
  {
    definition: {
      name: "list_my_issues",
      description:
        "List open GitHub issues assigned to the user across all repos. Use " +
        "when Sepiol asks what issues are on his plate or assigned to him.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const r = await ghRequest("/issues?filter=assigned&state=open&per_page=20");
      if (!r.ok) return r.error!;
      const issues =
        (r.data as Array<{ number: number; title: string; repository?: { full_name?: string } }>) ?? [];
      if (!issues.length) return "No open issues are assigned to you.";
      return (
        `${issues.length} open issue${issues.length === 1 ? "" : "s"} assigned to you: ` +
        issues
          .map((i) => `#${i.number} "${i.title}" in ${i.repository?.full_name ?? "a repo"}`)
          .join("; ") +
        "."
      );
    },
  },
  {
    definition: {
      name: "list_github_notifications",
      description:
        "List the user's unread GitHub notifications — what needs their " +
        "attention. Use when Sepiol asks what's new or needs attention on GitHub.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const r = await ghRequest("/notifications?per_page=15");
      if (!r.ok) return r.error!;
      const notes =
        (r.data as Array<{ subject?: { title?: string; type?: string }; repository?: { full_name?: string } }>) ??
        [];
      if (!notes.length) return "No unread GitHub notifications.";
      return (
        `${notes.length} notification${notes.length === 1 ? "" : "s"}: ` +
        notes
          .map((nx) => `${nx.subject?.type ?? "item"} "${nx.subject?.title ?? ""}" in ${nx.repository?.full_name ?? "a repo"}`)
          .join("; ") +
        "."
      );
    },
  },
  {
    definition: {
      name: "create_github_issue",
      description:
        "Create a new GitHub issue. This WRITES to GitHub. You MUST first tell " +
        "Sepiol exactly what you'll create (repo, title, body) and get an explicit " +
        "spoken 'yes'. Only then call this with confirm=true. Never set confirm=true " +
        "unless Sepiol just confirmed this specific issue.",
      input_schema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/name, e.g. RichardNzembei/jarvis" },
          title: { type: "string", description: "Issue title" },
          body: { type: "string", description: "Issue body (optional)" },
          confirm: {
            type: "boolean",
            description: "Must be true; only after Sepiol verbally confirms this exact issue.",
          },
        },
        required: ["repo", "title", "confirm"],
      },
    },
    handler: async (input) => {
      if (input.confirm !== true) {
        return "Not confirmed. Read the repo, title and body back to Sepiol and get an explicit yes before creating it.";
      }
      const repo = typeof input.repo === "string" ? input.repo : "";
      const title = typeof input.title === "string" ? input.title : "";
      if (!repo.includes("/") || !title) return "Need a repo as owner/name and a title.";
      const r = await ghRequest(`/repos/${repo}/issues`, {
        method: "POST",
        body: { title, body: typeof input.body === "string" ? input.body : undefined },
      });
      if (!r.ok) return r.error!;
      const issue = r.data as { number: number; html_url: string };
      return `Done — created issue #${issue.number} in ${repo}.`;
    },
  },
  {
    definition: {
      name: "get_unread_emails",
      description:
        "Check the user's Gmail inbox for unread messages. Use when Sepiol asks " +
        "about unread email, new mail, or whether anything needs his attention in email.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const r = await readMail({ mailbox: "INBOX", unreadOnly: true, limit: 10 });
      if (!r.ok) return r.error!;
      const items = r.items ?? [];
      if (!items.length) return "Your inbox is all caught up — no unread emails.";
      const more =
        (r.total ?? items.length) > items.length
          ? ` (the latest ${items.length} of ${r.total})`
          : "";
      return (
        `${r.total} unread email${r.total === 1 ? "" : "s"}${more}: ` +
        items.map((m) => `from ${m.from}, "${m.subject}"`).join("; ") +
        "."
      );
    },
  },
  {
    definition: {
      name: "get_recent_emails",
      description:
        "List the most recent emails in the user's Gmail inbox (read or unread). " +
        "Use when Sepiol asks what's in his inbox or about recent mail.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const r = await readMail({ mailbox: "INBOX", limit: 8 });
      if (!r.ok) return r.error!;
      const items = r.items ?? [];
      if (!items.length) return "Your inbox is empty.";
      return (
        `Your ${items.length} most recent emails: ` +
        items.map((m) => `from ${m.from}, "${m.subject}"`).join("; ") +
        "."
      );
    },
  },
  {
    definition: {
      name: "send_whatsapp",
      description:
        "Send a WhatsApp message via the WhatsApp Business Cloud API. This SENDS a " +
        "message on Sepiol's behalf — you MUST first read back the recipient and the " +
        "exact message and get an explicit spoken 'yes', then call with confirm=true. " +
        "Note: free-form text only reaches people who messaged the business number in " +
        "the last 24 hours; first contact needs a pre-approved template.",
      input_schema: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description:
              "Recipient phone in international format, digits only, e.g. 254712345678",
          },
          message: { type: "string", description: "The text to send" },
          confirm: {
            type: "boolean",
            description: "Must be true; only after Sepiol confirms the recipient and message.",
          },
        },
        required: ["to", "message", "confirm"],
      },
    },
    handler: async (input) => {
      if (input.confirm !== true) {
        return "Not confirmed. Read the recipient and the message back to Sepiol and get an explicit yes before sending.";
      }
      const token = process.env.WHATSAPP_TOKEN;
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      if (!token || !phoneId) {
        return "WhatsApp isn't configured on the server (no WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID).";
      }
      const to = (typeof input.to === "string" ? input.to : "").replace(/[^0-9]/g, "");
      const message = typeof input.message === "string" ? input.message : "";
      if (!to || !message) {
        return "Need a recipient number (digits, with country code) and a message.";
      }
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${phoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: message },
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        messages?: Array<{ id?: string }>;
      };
      if (!res.ok) {
        return `WhatsApp send failed: ${data.error?.message ?? `HTTP ${res.status}`}`;
      }
      return `Message sent to ${to}.`;
    },
  },
  {
    definition: {
      name: "search_emails",
      description:
        "Search the user's entire Gmail (all mail — including archived and sent) " +
        "by a keyword matched against sender, subject, and body. Use whenever " +
        "Sepiol asks to find a specific email or messages from/about someone " +
        "(e.g. 'find my Netflix emails', 'anything from the bank?').",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keyword or name to search for, e.g. 'Netflix' or 'invoice'",
          },
        },
        required: ["query"],
      },
    },
    handler: async (input) => {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query) return "Tell me what to search for.";
      const r = await readMail({ special: "\\All", query, limit: 12 });
      if (!r.ok) return r.error!;
      const items = r.items ?? [];
      if (!items.length) return `No emails found matching "${query}".`;
      const more =
        (r.total ?? items.length) > items.length
          ? ` (showing the latest ${items.length} of ${r.total})`
          : "";
      return (
        `${r.total} email${r.total === 1 ? "" : "s"} matching "${query}"${more}: ` +
        items.map((m) => `from ${m.from}, "${m.subject}" (${m.date})`).join("; ") +
        "."
      );
    },
  },
  {
    definition: {
      name: "get_sent_emails",
      description:
        "List the user's most recently sent emails. Use when Sepiol asks what " +
        "he sent recently or about his Sent mail.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const r = await readMail({ special: "\\Sent", limit: 8 });
      if (!r.ok) return r.error!;
      const items = r.items ?? [];
      if (!items.length) return "No sent emails found.";
      return (
        `Your ${items.length} most recent sent emails: ` +
        items.map((m) => `to ${m.to}, "${m.subject}"`).join("; ") +
        "."
      );
    },
  },
  {
    definition: {
      name: "get_drafts",
      description:
        "List the user's saved Gmail drafts. Use when Sepiol asks about drafts " +
        "or unfinished emails.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    handler: async () => {
      const r = await readMail({ special: "\\Drafts", limit: 8 });
      if (!r.ok) return r.error!;
      const items = r.items ?? [];
      if (!items.length) return "You have no drafts.";
      return (
        `You have ${r.total} draft${r.total === 1 ? "" : "s"}; latest: ` +
        items.map((m) => `to ${m.to || "no recipient"}, "${m.subject}"`).join("; ") +
        "."
      );
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
