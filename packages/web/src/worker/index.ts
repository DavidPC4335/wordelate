import dailyPuzzles from "../../public/puzzles.json" with { type: "json" };
import { retentionStart } from "../lib/standings.js";
import { decodePack } from "../lib/pack.js";
import type { Pack } from "../lib/pack.js";
import { mergePuzzles, puzzleAt } from "../lib/puzzles.js";
import { calendarDay } from "../lib/storage.js";
import { handleAdmin, handleSchedule } from "./admin.js";
import { accountFromRequest, handleAccount, isAccountPath } from "./account.js";
import { ensureSchedule } from "./schedule.js";
import { archiveExpiredDays } from "./archive.js";
import { backupAccounts } from "./backup.js";
import { GOOGLE_ENDPOINTS } from "./google.js";
import type { GoogleConfig } from "./google.js";
import { handleBoard } from "./handle.js";
import type { Sql } from "./sql.js";

const scheduled = mergePuzzles(dailyPuzzles);
const catalog = new Map(scheduled.map((puzzle) => [puzzle.id, puzzle]));

let packPromise: Promise<Pack> | null = null;

function d1sql(db: D1Database): Sql {
  return {
    async get(statement, params) {
      const row = await db.prepare(statement).bind(...params).first();
      if (!row || typeof row !== "object") return null;
      return row as Record<string, unknown> as never;
    },
    async all(statement, params) {
      const result = await db.prepare(statement).bind(...params).all();
      return result.results as Record<string, unknown>[] as never;
    },
    async run(statement, params) {
      const result = await db.prepare(statement).bind(...params).run();
      return result.meta.changes ?? 0;
    },
  };
}

function r2archive(bucket: R2Bucket): { put(key: string, body: string): Promise<void> } {
  return {
    async put(key, body) {
      await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });
    },
  };
}

/** The public half of the Google client. The secret half is a Worker secret. */
const GOOGLE_CLIENT_ID = "149960639425-l7m7foks7b17vl7a51qs8hsht10r31vc.apps.googleusercontent.com";
const GOOGLE_REDIRECT_URI = "https://wordelate.com/auth/redirect";

function googleConfig(env: Env): GoogleConfig {
  return {
    clientId: env.GOOGLE_CLIENT_ID ?? GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: env.GOOGLE_REDIRECT_URI ?? GOOGLE_REDIRECT_URI,
    authUri: env.GOOGLE_AUTH_URI ?? GOOGLE_ENDPOINTS.authUri,
    tokenUri: env.GOOGLE_TOKEN_URI ?? GOOGLE_ENDPOINTS.tokenUri,
    jwksUri: env.GOOGLE_JWKS_URI ?? GOOGLE_ENDPOINTS.jwksUri,
    issuers: env.GOOGLE_ISSUER ? [env.GOOGLE_ISSUER] : [...GOOGLE_ENDPOINTS.issuers],
  };
}

function loadPack(assets: Fetcher, requestUrl: string): Promise<Pack> {
  if (!packPromise) {
    packPromise = (async () => {
      const response = await assets.fetch(new Request(new URL("/vocab/nearest.i8", requestUrl)));
      if (!response.ok) throw new Error(`Vocabulary asset failed (${response.status})`);
      return decodePack(await response.arrayBuffer(), () => {});
    })().catch((error: unknown) => {
      packPromise = null;
      throw error;
    });
  }
  return packPromise;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (isAccountPath(url.pathname)) {
      return handleAccount(request, {
        sql: d1sql(env.DB),
        secret: env.ACCOUNT_SECRET ?? "",
        now: () => Date.now(),
        google: googleConfig(env),
        fetcher: (input, init) => fetch(input, init),
      });
    }
    const now = Date.now();
    const sql = d1sql(env.DB);
    const accountDeps = {
      sql,
      secret: env.ACCOUNT_SECRET ?? "",
      now: () => now,
      google: googleConfig(env),
      fetcher: (input: string, init?: RequestInit) => fetch(input, init),
    };
    if (url.pathname === "/api/schedule" && request.method === "GET") return handleSchedule(accountDeps, scheduled);
    if (url.pathname === "/api/admin" || url.pathname.startsWith("/api/admin/")) return handleAdmin(request, accountDeps, scheduled);
    let pack: Pack | null = null;
    let dailyPuzzleId = puzzleAt(scheduled, calendarDay(new Date(now)))?.id ?? "";
    let puzzleLookup = (id: string) => catalog.get(id) ?? null;
    if (url.pathname === "/api/score") {
      try {
        pack = await loadPack(env.ASSETS, request.url);
      } catch (error) {
        console.error(JSON.stringify({ event: "pack", message: error instanceof Error ? error.message : "failed" }));
      }
      try {
        const stack = await ensureSchedule(sql, scheduled, now);
        const byId = new Map(stack.map((puzzle) => [puzzle.id, puzzle]));
        puzzleLookup = (id) => byId.get(id) ?? null;
        dailyPuzzleId = puzzleAt(stack, calendarDay(new Date(now)))?.id ?? "";
      } catch (error) {
        console.error(JSON.stringify({ event: "schedule", message: error instanceof Error ? error.message : "failed" }));
      }
    }
    return handleBoard(request, {
      sql,
      secret: env.LEADERBOARD_SECRET,
      now: () => now,
      pack,
      puzzle: puzzleLookup,
      dailyPuzzleId,
      account: async (incoming) => {
        const user = await accountFromRequest(incoming, sql, now);
        return user ? { id: user.id, name: user.displayName, picture: user.showPicture ? user.picture : null } : null;
      },
    });
  },
  async scheduled(_controller, env, ctx): Promise<void> {
    const sql = d1sql(env.DB);
    ctx.waitUntil(
      (async () => {
        const now = Date.now();
        const today = calendarDay(new Date(now));
        const result = await archiveExpiredDays(sql, r2archive(env.ARCHIVE), retentionStart(today), now);
        console.log(JSON.stringify({ event: "archive", day: today, archived: result.days }));
      })().catch((error: unknown) => {
        console.error(JSON.stringify({ event: "purge", message: error instanceof Error ? error.message : "failed" }));
      }),
    );
    // Accounts are copied whole each week. This runs on its own so one failure cannot hide the other.
    ctx.waitUntil(
      (async () => {
        const now = Date.now();
        const today = calendarDay(new Date(now));
        const result = await backupAccounts(sql, r2archive(env.ARCHIVE), today, now);
        console.log(JSON.stringify({ event: "account-backup", day: today, ...result }));
      })().catch((error: unknown) => {
        console.error(JSON.stringify({ event: "account-backup", message: error instanceof Error ? error.message : "failed" }));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
