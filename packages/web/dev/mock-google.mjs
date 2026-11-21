// A stand-in for Google, for trying the login flow on this machine only.
// Real Google only returns to https://wordelate.com, so it cannot call back to localhost.
// It signs real RS256 ID tokens, and checks PKCE the way Google does.
import { createServer } from "node:http";
import { createHash, generateKeyPairSync, createSign } from "node:crypto";

const PORT = Number(process.env.MOCK_GOOGLE_PORT ?? 8788);
const ISSUER = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = process.env.MOCK_CLIENT_ID ?? "149960639425-l7m7foks7b17vl7a51qs8hsht10r31vc.apps.googleusercontent.com";
const CLIENT_SECRET = process.env.MOCK_CLIENT_SECRET ?? "local-mock-secret";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "mock-1", use: "sig", alg: "RS256" };

const people = {
  ada: { sub: "mock-ada", name: "Ada Lovelace", given_name: "Ada", email: "ada@example.com", picture: "https://lh3.googleusercontent.com/a/mock-ada" },
  bob: { sub: "mock-bob", name: "Bob Barker", given_name: "Bob", email: "bob@example.com" },
  cy: { sub: "mock-cy", name: "Cy Young", given_name: "Cy", email: "cy@example.com" },
};

const grants = new Map();
const b64 = (value) => Buffer.from(value).toString("base64url");

function idToken(claims) {
  const head = b64(JSON.stringify({ alg: "RS256", kid: "mock-1", typ: "JWT" }));
  const body = b64(JSON.stringify(claims));
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(privateKey).toString("base64url")}`;
}

function page(res, status, html) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset=utf-8><title>Mock Google</title><body style="font:16px system-ui;max-width:26rem;margin:3rem auto">${html}`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", ISSUER);
  if (url.pathname === "/auth") {
    const q = url.searchParams;
    if (q.get("client_id") !== CLIENT_ID || q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256") {
      return page(res, 400, "<h1>Bad request</h1>");
    }
    const who = q.get("person");
    if (!who) {
      const links = Object.entries(people)
        .map(([key, p]) => {
          const next = new URL(url);
          next.searchParams.set("person", key);
          return `<p><a href="${next.pathname}${next.search}">Continue as ${p.name}</a> (${p.email})</p>`;
        })
        .join("");
      return page(res, 200, `<h1>Mock Google</h1><p>Choose an account.</p>${links}<p><a href="${q.get("redirect_uri")}?error=access_denied&state=${encodeURIComponent(q.get("state") ?? "")}">Cancel</a></p>`);
    }
    const code = b64(crypto.getRandomValues(new Uint8Array(24)));
    grants.set(code, {
      person: people[who],
      challenge: q.get("code_challenge"),
      nonce: q.get("nonce"),
      redirect: q.get("redirect_uri"),
    });
    const back = new URL(q.get("redirect_uri"));
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.get("state") ?? "");
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (url.pathname === "/token" && req.method === "POST") {
    let text = "";
    for await (const chunk of req) text += chunk;
    const form = new URLSearchParams(text);
    const grant = grants.get(form.get("code") ?? "");
    const verifierHash = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
    const valid =
      grant &&
      form.get("client_secret") === CLIENT_SECRET &&
      form.get("client_id") === CLIENT_ID &&
      form.get("redirect_uri") === grant.redirect &&
      verifierHash === grant.challenge;
    res.setHeader("content-type", "application/json");
    if (!valid) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "invalid_grant" }));
    }
    grants.delete(form.get("code"));
    const now = Math.floor(Date.now() / 1000);
    return res.end(
      JSON.stringify({
        access_token: "unused",
        id_token: idToken({ iss: ISSUER, aud: CLIENT_ID, iat: now, exp: now + 3600, email_verified: true, nonce: grant.nonce, ...grant.person }),
      }),
    );
  }
  if (url.pathname === "/certs") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ keys: [jwk] }));
  }
  page(res, 404, "<h1>Not found</h1>");
});

server.listen(PORT, "127.0.0.1", () => console.log(`Mock Google on ${ISSUER}`));
