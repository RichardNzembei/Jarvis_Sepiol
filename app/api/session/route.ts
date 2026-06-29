import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Report whether the caller holds a valid session cookie. Source of truth
 *  for the client's locked/unlocked UI — no client-side flag to desync. */
export async function GET(req: Request) {
  return Response.json({ authed: isAuthed(req) });
}
