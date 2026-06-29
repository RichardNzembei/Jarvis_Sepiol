import { timingSafeEqual } from "crypto";

const COOKIE = "jarvis_auth";

/** Constant-time string compare (avoids timing leaks on the secret). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** True if the request carries a valid session cookie matching the server secret. */
export function isAuthed(req: Request): boolean {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) return false;
  const cookie = req.headers.get("cookie") ?? "";
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie);
  if (!match) return false;
  return safeEqual(decodeURIComponent(match[1]), secret);
}

/** Build the Set-Cookie header value that marks a session as unlocked. */
export function sessionCookie(): string {
  const secret = process.env.APP_SESSION_SECRET ?? "";
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  // 30 days, HttpOnly so page JS can't read it, Lax for same-site nav.
  return `${COOKIE}=${encodeURIComponent(secret)}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax${secure}`;
}
