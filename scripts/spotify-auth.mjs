#!/usr/bin/env node
/**
 * One-time Spotify authorization for JARVIS (run: npm run spotify:auth).
 *
 * Opens the Spotify consent page, catches the redirect on a loopback server,
 * exchanges the code, and PRINTS the refresh token for you to paste into
 * .env.local — it never writes your secrets file. Zero dependencies.
 *
 * Spotify facts this script encodes (verified July 2026):
 * - Redirect URIs must use the loopback IP literal 127.0.0.1 (localhost is
 *   banned). Register http://127.0.0.1:8888/callback in the app dashboard.
 * - Refresh tokens expire 6 months after THIS authorization (refreshing does
 *   not extend it), so we also print SPOTIFY_AUTH_DATE — lib/spotify.ts uses
 *   it to warn before expiry. Re-run this script roughly twice a year.
 */

import http from "node:http";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";

const PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
// Phase-1 scopes (playback read + control). Phase 2 (Web Playback SDK) will
// need `streaming` added — re-run this script then.
const SCOPES =
  "user-read-playback-state user-modify-playback-state user-read-currently-playing";

function readEnvLocal() {
  try {
    const out = {};
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const env = readEnvLocal();
const clientId = env.SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID;
const clientSecret = env.SPOTIFY_CLIENT_SECRET || process.env.SPOTIFY_CLIENT_SECRET;

/**
 * Manual mode — for when the dashboard won't accept the loopback redirect.
 * Uses any redirect URI already registered on the app (a deployed URL that
 * 404s is fine; the code arrives in the browser's address bar):
 *
 *   node scripts/spotify-auth.mjs --redirect https://your-app/callback
 *     → prints the authorize URL; approve, then copy the URL you land on
 *   node scripts/spotify-auth.mjs --code-url "https://your-app/callback?code=…"
 *     → exchanges the code (redirect_uri is derived from the pasted URL)
 */
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function exchange(code, redirectUri) {
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  const data = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !data.refresh_token) {
    console.error(`Token exchange failed (${tokenRes.status}): ${JSON.stringify(data).slice(0, 300)}`);
    process.exit(1);
  }
  console.log("\nAdd these two lines to .env.local:\n");
  console.log(`SPOTIFY_REFRESH_TOKEN=${data.refresh_token}`);
  console.log(`SPOTIFY_AUTH_DATE=${new Date().toISOString().slice(0, 10)}`);
  console.log("\n(Spotify expires this authorization 6 months from today — Jarvis will remind you.)");
  process.exit(0);
}

const codeUrl = flag("--code-url");
if (codeUrl) {
  const u = new URL(codeUrl);
  const code = u.searchParams.get("code");
  if (!code) {
    console.error("That URL has no ?code= parameter — copy the FULL URL you landed on after approving.");
    process.exit(1);
  }
  await exchange(code, `${u.origin}${u.pathname}`);
}

const manualRedirect = flag("--redirect");
if (manualRedirect) {
  const url =
    "https://accounts.spotify.com/authorize?" +
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: manualRedirect,
      scope: SCOPES,
    });
  console.log("Open this URL, approve, then copy the FULL URL of the page you land on\n(a 404 there is fine — the code is in the address bar):\n\n" + url + "\n");
  console.log(`Then run:\n  npm run spotify:auth -- --code-url "<that URL>"`);
  if (process.platform === "darwin") execFile("open", [url], () => {});
  process.exit(0);
}

if (!clientId || !clientSecret) {
  console.error(
    [
      "Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET.",
      "",
      "1. Create an app at https://developer.spotify.com/dashboard",
      `2. Add this Redirect URI to it exactly: ${REDIRECT_URI}`,
      "3. Put SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.local",
      "4. Re-run: npm run spotify:auth",
    ].join("\n"),
  );
  process.exit(1);
}

const state = crypto.randomBytes(16).toString("hex");
const authUrl =
  "https://accounts.spotify.com/authorize?" +
  new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  const fail = (msg) => {
    res.writeHead(400, { "Content-Type": "text/plain" }).end(msg);
    console.error(msg);
    process.exit(1);
  };
  if (url.searchParams.get("state") !== state) return fail("State mismatch — run the script again and use the freshly printed URL.");
  if (url.searchParams.get("error")) return fail(`Spotify said: ${url.searchParams.get("error")}`);

  const code = url.searchParams.get("code");
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI }),
  });
  const data = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !data.refresh_token) {
    return fail(`Token exchange failed (${tokenRes.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }

  res.writeHead(200, { "Content-Type": "text/plain" }).end("JARVIS is connected to Spotify. You can close this tab.");
  console.log("\nAdd these two lines to .env.local:\n");
  console.log(`SPOTIFY_REFRESH_TOKEN=${data.refresh_token}`);
  console.log(`SPOTIFY_AUTH_DATE=${new Date().toISOString().slice(0, 10)}`);
  console.log("\n(Spotify expires this authorization 6 months from today — Jarvis will remind you.)");
  server.close();
  process.exit(0);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Authorize JARVIS with Spotify — open:\n\n" + authUrl + "\n");
  console.log("Waiting for the redirect…");
  if (process.platform === "darwin") execFile("open", [authUrl], () => {});
});
