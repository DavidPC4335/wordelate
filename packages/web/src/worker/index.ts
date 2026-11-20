import dailyPuzzles from "../../public/puzzles.json" with { type: "json" };
import { retentionStart } from "../lib/standings.js";
import { decodePack } from "../lib/pack.js";
import type { Pack } from "../lib/pack.js";
import { mergePuzzles } from "../lib/puzzles.js";
import { calendarDay } from "../lib/storage.js";
import { archiveExpiredDays } from "./archive.js";
import { handleBoard } from "./handle.js";
import type { Sql } from "./sql.js";

const catalog = new Map(mergePuzzles(dailyPuzzles).map((puzzle) => [puzzle.id, puzzle]));

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
    let pack: Pack | null = null;
    if (url.pathname === "/api/score") {
      try {
        pack = await loadPack(env.ASSETS, request.url);
      } catch (error) {
        console.error(JSON.stringify({ event: "pack", message: error instanceof Error ? error.message : "failed" }));
      }
    }
    return handleBoard(request, {
      sql: d1sql(env.DB),
      secret: env.LEADERBOARD_SECRET,
      now: () => Date.now(),
      pack,
      puzzle: (id) => catalog.get(id) ?? null,
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
  },
} satisfies ExportedHandler<Env>;
