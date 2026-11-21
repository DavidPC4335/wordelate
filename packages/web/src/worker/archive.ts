import { daysBefore, deleteDay, deleteExpiredHits, scoresOnDay } from "./board-db.js";
import type { ScoreRow } from "./board-db.js";
import type { Sql } from "./sql.js";

/** Private long-term copy of one day's scores. */
export type ScoreArchive = {
  put(key: string, body: string): Promise<void>;
};

export type ArchiveResult = {
  days: string[];
};

export function archiveKey(day: string): string {
  return `scores/${day}.json`;
}

function archiveBody(day: string, archivedAt: string, scores: readonly ScoreRow[]): string {
  return JSON.stringify({
    day,
    archivedAt,
    scores: scores.map((row) => ({
      playerId: row.playerId,
      puzzleId: row.puzzleId,
      score: row.score,
      moves: row.moves,
      answer: row.answer,
      name: row.name,
      userId: row.userId,
      picture: row.picture,
      createdAt: row.createdAt,
    })),
  });
}

/**
 * Write each day older than `beforeDay` to the archive, then delete that day
 * from the database. A day that fails to upload stays in the database.
 */
export async function archiveExpiredDays(
  sql: Sql,
  archive: ScoreArchive,
  beforeDay: string,
  now: number,
): Promise<ArchiveResult> {
  const days = await daysBefore(sql, beforeDay);
  const archived: string[] = [];
  const failed: string[] = [];
  const archivedAt = new Date(now).toISOString();
  for (const day of days) {
    const scores = await scoresOnDay(sql, day);
    try {
      await archive.put(archiveKey(day), archiveBody(day, archivedAt, scores));
    } catch (error) {
      failed.push(day);
      console.error(
        JSON.stringify({
          event: "archive",
          day,
          message: error instanceof Error ? error.message : "failed",
        }),
      );
      continue;
    }
    await deleteDay(sql, day);
    archived.push(day);
  }
  await deleteExpiredHits(sql, now);
  if (failed.length > 0) {
    throw new Error(`Archive failed for ${failed.join(", ")}`);
  }
  return { days: archived };
}
