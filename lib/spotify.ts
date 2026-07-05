/**
 * Server-side Spotify Web API access for Jarvis's music tools.
 *
 * Follows the house patterns: a module-scope token cache with an in-flight
 * promise (like the IMAP singleton) and a small typed request helper (like
 * ghRequest). Secrets are read only from server env vars.
 *
 * Token lifecycle (verified July 2026): access tokens live 1 hour and are
 * refreshed here with a 60s margin; the refresh token itself expires 6 months
 * after the original consent (SPOTIFY_AUTH_DATE tracks that — Spotify tokens
 * carry no issuance timestamp), so tools warn Sepiol before it lapses.
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";
const AUTH_LIFETIME_DAYS = 180; // Spotify's 6-month refresh-token expiry
const WARN_WITHIN_DAYS = 14;

let accessToken: string | null = null;
let expiresAt = 0; // epoch ms
let refreshing: Promise<string> | null = null; // stampede guard
let authDeadUntil = 0; // backoff after invalid_grant so a dead token doesn't tax every call

export function spotifyConfigured(): boolean {
  return Boolean(
    process.env.SPOTIFY_CLIENT_ID &&
      process.env.SPOTIFY_CLIENT_SECRET &&
      process.env.SPOTIFY_REFRESH_TOKEN,
  );
}

/**
 * "" normally; a gentle reminder string when the 6-month authorization is
 * near/at expiry. Tools append it to successful results so Jarvis mentions it
 * in passing instead of failing cold later.
 */
export function authExpiryNote(): string {
  const raw = process.env.SPOTIFY_AUTH_DATE;
  if (!raw) return "";
  const authAt = Date.parse(raw);
  if (Number.isNaN(authAt)) return "";
  const daysLeft = Math.floor(
    (authAt + AUTH_LIFETIME_DAYS * 86_400_000 - Date.now()) / 86_400_000,
  );
  if (daysLeft < 0) {
    return " (Note: the Spotify authorization has likely expired — Sepiol should re-run the spotify auth script.)";
  }
  if (daysLeft <= WARN_WITHIN_DAYS) {
    return ` (Note: the Spotify authorization expires in about ${daysLeft} day${daysLeft === 1 ? "" : "s"} — Sepiol should re-run the spotify auth script soon.)`;
  }
  return "";
}

async function refreshAccessToken(): Promise<string> {
  const id = process.env.SPOTIFY_CLIENT_ID!;
  const secret = process.env.SPOTIFY_CLIENT_SECRET!;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN!;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    if (data.error === "invalid_grant") {
      authDeadUntil = Date.now() + 5 * 60_000;
      throw new Error(
        "Spotify authorization has expired or been revoked. Sepiol needs to re-run the spotify auth script (npm run spotify:auth).",
      );
    }
    throw new Error(`Spotify token refresh failed (${res.status}).`);
  }
  accessToken = data.access_token;
  expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  return accessToken;
}

async function getAccessToken(): Promise<string> {
  if (Date.now() < authDeadUntil) {
    throw new Error(
      "Spotify authorization has expired or been revoked. Sepiol needs to re-run the spotify auth script (npm run spotify:auth).",
    );
  }
  if (accessToken && Date.now() < expiresAt - 60_000) return accessToken;
  refreshing ??= refreshAccessToken().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export type SpResult =
  | { ok: true; status: number; data: unknown | null }
  | { ok: false; status: number; error: string };

/**
 * Call the Spotify Web API. Player endpoints return 204/202 with empty bodies
 * on success — treated as { data: null }, not an error. One automatic retry
 * after a forced refresh on 401. 429 surfaces Retry-After as friendly text.
 */
export async function spRequest(path: string, init?: RequestInit): Promise<SpResult> {
  if (!spotifyConfigured()) {
    return { ok: false, status: 0, error: "Spotify isn't configured (missing SPOTIFY_* env vars)." };
  }
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getAccessToken();
      const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 401 && attempt === 0) {
        accessToken = null; // stale — force refresh once, then retry
        continue;
      }
      if (res.status === 429) {
        const wait = res.headers.get("Retry-After") ?? "a few";
        return { ok: false, status: 429, error: `Spotify is rate limiting requests — try again in about ${wait} seconds.` };
      }

      const text = await res.text();
      const body = text ? (JSON.parse(text) as unknown) : null;

      if (res.ok) return { ok: true, status: res.status, data: body };

      const reason =
        (body as { error?: { message?: string; reason?: string } })?.error?.reason ?? "";
      const message =
        (body as { error?: { message?: string } })?.error?.message ?? text.slice(0, 200);
      if (res.status === 403 && reason === "PREMIUM_REQUIRED") {
        return { ok: false, status: 403, error: "Spotify says playback control requires a Premium subscription." };
      }
      if (res.status === 404 && /device/i.test(message)) {
        return { ok: false, status: 404, error: "NO_ACTIVE_DEVICE" };
      }
      return { ok: false, status: res.status, error: `Spotify API error ${res.status}: ${message}` };
    }
    return { ok: false, status: 401, error: "Spotify authentication failed twice — the credentials may be wrong." };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ---------------------- formatting & device helpers ---------------------- */

type SpotifyTrack = {
  name?: string;
  uri?: string;
  type?: string;
  artists?: { name: string }[];
  album?: { name: string };
  show?: { name: string }; // podcast episodes
  duration_ms?: number;
};

/** Strip characters TTS chokes on (emoji, control chars); keep real letters. */
function speakable(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** `"Kettering" by The Antlers, from Hospice` — speakable, no URIs. */
export function fmtTrack(item: SpotifyTrack | null | undefined): string {
  if (!item?.name) return "an unnamed item";
  const name = speakable(item.name);
  if (item.type === "episode") {
    return `the episode "${name}"${item.show?.name ? ` from ${speakable(item.show.name)}` : ""}`;
  }
  const artists = (item.artists ?? []).map((a) => speakable(a.name)).join(", ");
  const album = item.album?.name ? `, from ${speakable(item.album.name)}` : "";
  return `"${name}"${artists ? ` by ${artists}` : ""}${album}`;
}

export function fmtMs(ms: number | undefined): string {
  if (!ms || ms < 0) return "0:00";
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type SpotifyDevice = { id: string; name: string; is_active: boolean; type: string };

export async function listDevices(): Promise<
  { ok: true; devices: SpotifyDevice[] } | { ok: false; error: string }
> {
  const r = await spRequest("/me/player/devices");
  if (!r.ok) return { ok: false, error: r.error };
  const devices = ((r.data as { devices?: SpotifyDevice[] })?.devices ?? []).filter((d) => d.id);
  return { ok: true, devices };
}

/**
 * Resolve an optional device name to an id. With no name: prefer the active
 * device (undefined lets Spotify default), else null. Ambiguity/absence
 * returns a speakable string that teaches the model the recovery move.
 */
export async function resolveDevice(
  name?: string,
): Promise<{ id: string | undefined } | { fail: string }> {
  if (!name) return { id: undefined };
  const r = await listDevices();
  if (!r.ok) return { fail: r.error };
  const needle = name.toLowerCase();
  const matches = r.devices.filter((d) => d.name.toLowerCase().includes(needle));
  if (matches.length === 1) return { id: matches[0].id };
  if (matches.length === 0) {
    const known = r.devices.map((d) => `"${speakable(d.name)}"`).join(", ");
    return {
      fail: known
        ? `No Spotify device matching "${name}". Available: ${known}.`
        : `No Spotify devices are visible right now. Sepiol may need to open Spotify somewhere first.`,
    };
  }
  return {
    fail: `Several devices match "${name}": ${matches.map((d) => `"${speakable(d.name)}"`).join(", ")} — ask Sepiol which one.`,
  };
}

/** Speakable idle-device inventory for no-active-device recovery messages. */
export async function deviceInventory(): Promise<string> {
  const r = await listDevices();
  if (!r.ok || r.devices.length === 0) {
    return "No Spotify devices are visible — Sepiol may need to open Spotify on a device first.";
  }
  const names = r.devices.map((d) => `"${speakable(d.name)}"${d.is_active ? " (active)" : ""}`);
  return `Open but idle Spotify devices: ${names.join(", ")}. Playback can be started on one by including its name.`;
}
