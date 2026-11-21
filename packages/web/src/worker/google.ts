/**
 * Sign in with Google, using the authorization code flow with PKCE.
 * The browser never sees the code exchange or the ID token. The Worker does the exchange,
 * then checks the token's signature and every claim before trusting who it names.
 */

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  /** Must match a redirect URI registered with Google exactly. */
  redirectUri: string;
  authUri: string;
  tokenUri: string;
  jwksUri: string;
  issuers: readonly string[];
};

export const GOOGLE_ENDPOINTS = {
  authUri: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUri: "https://oauth2.googleapis.com/token",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"],
} as const;

export type GoogleIdentity = {
  sub: string;
  email: string;
  fullName: string;
  givenName: string;
  picture: string | null;
};

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const SKEW_SECONDS = 60;
const MAX_TOKEN_CHARS = 8192;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function randomToken(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function authorizeUrl(
  config: GoogleConfig,
  input: { state: string; nonce: string; challenge: string },
): string {
  const url = new URL(config.authUri);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

type Jwk = JsonWebKey & { kid?: string };

const keyCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const KEY_TTL_MS = 60 * 60 * 1000;

async function loadKeys(config: GoogleConfig, fetcher: Fetcher, now: number, force: boolean): Promise<Jwk[]> {
  const cached = keyCache.get(config.jwksUri);
  if (!force && cached && now - cached.fetchedAt < KEY_TTL_MS) return cached.keys;
  const response = await fetcher(config.jwksUri, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Key fetch failed (${response.status})`);
  const body = (await response.json()) as { keys?: unknown };
  const keys = Array.isArray(body.keys) ? (body.keys as Jwk[]) : [];
  keyCache.set(config.jwksUri, { keys, fetchedAt: now });
  return keys;
}

async function signatureValid(signed: string, signature: Uint8Array<ArrayBuffer>, jwk: Jwk): Promise<boolean> {
  if (jwk.kty !== "RSA") return false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(signed));
  } catch {
    return false;
  }
}

function decodePart(part: string): Record<string, unknown> | null {
  const bytes = base64UrlToBytes(part);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function plainText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\p{C}]+/gu, "").trim().slice(0, max) : "";
}

/** Google profile pictures live on googleusercontent.com. Nothing else is kept. */
function safePicture(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/(^|\.)googleusercontent\.com$/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The person an ID token names, or null when anything about the token is wrong. */
export async function verifyIdToken(
  config: GoogleConfig,
  token: string,
  expectedNonce: string,
  fetcher: Fetcher,
  now: number,
): Promise<GoogleIdentity | null> {
  if (token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headPart, bodyPart, sigPart] = parts as [string, string, string];
  const header = decodePart(headPart);
  const claims = decodePart(bodyPart);
  const signature = base64UrlToBytes(sigPart);
  if (!header || !claims || !signature) return null;
  // Only the algorithm Google signs with. "none" and keyed algorithms are refused.
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const signed = `${headPart}.${bodyPart}`;
  let valid = false;
  for (const force of [false, true]) {
    const keys = await loadKeys(config, fetcher, now, force);
    const jwk = keys.find((key) => key.kid === header.kid);
    if (jwk && (await signatureValid(signed, signature, jwk))) {
      valid = true;
      break;
    }
  }
  if (!valid) return null;

  const seconds = Math.floor(now / 1000);
  if (typeof claims.iss !== "string" || !config.issuers.includes(claims.iss)) return null;
  const audience = claims.aud;
  const audiences = Array.isArray(audience) ? audience : [audience];
  if (!audiences.includes(config.clientId)) return null;
  if (Array.isArray(audience) && claims.azp !== config.clientId) return null;
  if (typeof claims.exp !== "number" || claims.exp <= seconds - SKEW_SECONDS) return null;
  if (typeof claims.iat !== "number" || claims.iat > seconds + SKEW_SECONDS * 5) return null;
  if (typeof claims.nonce !== "string" || claims.nonce !== expectedNonce) return null;
  if (typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 255) return null;
  if (typeof claims.email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(claims.email) || claims.email.length > 320) return null;
  if (claims.email_verified !== true && claims.email_verified !== "true") return null;

  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    fullName: plainText(claims.name, 200),
    givenName: plainText(claims.given_name, 100),
    picture: safePicture(claims.picture),
  };
}

/** Trade the one-time code for an ID token, then verify it. */
export async function completeLogin(
  config: GoogleConfig,
  input: { code: string; verifier: string; nonce: string },
  fetcher: Fetcher,
  now: number,
): Promise<GoogleIdentity | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code_verifier: input.verifier,
  });
  const response = await fetcher(config.tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const result = (await response.json()) as { id_token?: unknown };
  if (typeof result.id_token !== "string") return null;
  return verifyIdToken(config, result.id_token, input.nonce, fetcher, now);
}
