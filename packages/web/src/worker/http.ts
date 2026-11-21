/** Small request and response helpers shared by the board and the accounts. */

export type Failure = { ok: false; status: number; error: string };

export function json(body: unknown, status: number, headers?: Headers): Response {
  const out = headers ?? new Headers();
  out.set("content-type", "application/json; charset=utf-8");
  out.set("x-content-type-options", "nosniff");
  out.set("cache-control", "no-store");
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: out });
}

export function fail(status: number, error: string): Response {
  return json({ error }, status);
}

/** Cross-site requests are refused. Local development may talk across its own ports. */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let sent: URL;
  try {
    sent = new URL(origin);
  } catch {
    return false;
  }
  const target = new URL(request.url);
  if (sent.origin === target.origin) return true;
  const local = (host: string) => host === "localhost" || host === "127.0.0.1";
  return local(sent.hostname) && local(target.hostname);
}

export function clientIp(request: Request): string {
  const header = request.headers.get("CF-Connecting-IP") ?? "";
  if (/^[0-9a-fA-F:.]{3,64}$/.test(header)) return header;
  return "unknown";
}

export function secureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

/** The value of one cookie, or null. */
export function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

/**
 * Over https the cookie name carries the __Host- prefix, which makes the browser refuse
 * a cookie that was planted by a sibling subdomain or sent without Secure and Path=/.
 */
export function cookieName(base: string, secure: boolean): string {
  return secure ? `__Host-${base}` : base;
}

export function setCookie(name: string, value: string, options: { maxAge: number; secure: boolean }): string {
  const flags = [`${name}=${value}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${options.maxAge}`];
  if (options.secure) flags.push("Secure");
  return flags.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  return setCookie(name, "", { maxAge: 0, secure });
}

/** A JSON body, only when the request really says it is JSON. A form post from another site cannot. */
export async function readJson(request: Request, maxChars: number): Promise<{ ok: true; value: unknown } | Failure> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return { ok: false, status: 415, error: "That request was not understood." };
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxChars) {
    return { ok: false, status: 413, error: "That request is too large." };
  }
  const text = await request.text();
  if (text.length > maxChars) return { ok: false, status: 413, error: "That request is too large." };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "That request was not understood." };
  }
}
