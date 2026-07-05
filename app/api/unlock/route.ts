import { safeEqual, sessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Brute-force lockout: after MAX_FAILS wrong passphrases from one IP within
 * WINDOW_MS, reject with 429 until the window expires. In-memory, so a cold
 * start resets it — but a warm instance is exactly where a rapid brute-force
 * would land, and the passphrase is human-memorable, so this is the guard
 * that matters.
 */
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map<string, { count: number; first: number }>();

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

function isLockedOut(ip: string): number | null {
  const entry = fails.get(ip);
  if (!entry) return null;
  if (Date.now() - entry.first > WINDOW_MS) {
    fails.delete(ip);
    return null;
  }
  if (entry.count < MAX_FAILS) return null;
  return Math.ceil((entry.first + WINDOW_MS - Date.now()) / 1000);
}

function recordFail(ip: string) {
  const now = Date.now();
  // Opportunistically prune expired entries so the map can't grow unbounded.
  for (const [key, entry] of fails) {
    if (now - entry.first > WINDOW_MS) fails.delete(key);
  }
  const entry = fails.get(ip);
  if (entry) entry.count += 1;
  else fails.set(ip, { count: 1, first: now });
}

/**
 * Verify the access key. On success, set an HttpOnly session cookie that
 * /api/chat checks. The expected key (APP_PASSPHRASE) and the session secret
 * live only in server env vars — never shipped to the browser.
 */
export async function POST(req: Request) {
  const expected = process.env.APP_PASSPHRASE;
  const secret = process.env.APP_SESSION_SECRET;
  if (!expected || !secret) {
    return Response.json(
      { error: "Auth is not configured on the server." },
      { status: 500 },
    );
  }

  const ip = clientIp(req);
  const retryAfter = isLockedOut(ip);
  if (retryAfter !== null) {
    return Response.json(
      { ok: false, error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body: { passphrase?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
  if (!safeEqual(passphrase, expected)) {
    recordFail(ip);
    return Response.json({ ok: false }, { status: 401 });
  }

  fails.delete(ip);

  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookie() } },
  );
}
