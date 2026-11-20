const COOKIE = "wl_session";
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const SKEW_MS = 5 * 60 * 1000;

export type Session = { playerId: string; issuedAt: number };

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(text)) return null;
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

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

async function mac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return new Uint8Array(signed);
}

export function newPlayerId(): string {
  return crypto.randomUUID();
}

export async function issueSession(secret: string, now: number): Promise<{ session: Session; token: string }> {
  const session = { playerId: newPlayerId(), issuedAt: now };
  const payload = `${session.playerId}.${session.issuedAt}`;
  const token = `${payload}.${bytesToBase64Url(await mac(secret, payload))}`;
  return { session, token };
}

export async function readSession(secret: string, token: string, now: number): Promise<Session | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const playerId = parts[0];
  const issuedText = parts[1];
  const signature = parts[2];
  if (!playerId || !issuedText || !signature) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(playerId)) return null;
  if (!/^\d{10,16}$/.test(issuedText)) return null;
  const issuedAt = Number(issuedText);
  if (!Number.isSafeInteger(issuedAt)) return null;
  if (issuedAt > now + SKEW_MS || issuedAt < now - MAX_AGE_MS) return null;
  const provided = base64UrlToBytes(signature);
  if (!provided || provided.length !== 32) return null;
  const expected = await mac(secret, `${playerId}.${issuedText}`);
  if (!sameBytes(provided, expected)) return null;
  return { playerId, issuedAt };
}

export function readCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === COOKIE) return trimmed.slice(eq + 1);
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  const flags = [`${COOKIE}=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=31536000"];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}
