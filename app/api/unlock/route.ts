import { safeEqual, sessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

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

  let body: { passphrase?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
  if (!safeEqual(passphrase, expected)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": sessionCookie() } },
  );
}
