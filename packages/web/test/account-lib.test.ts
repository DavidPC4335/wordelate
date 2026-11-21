import { describe, expect, it } from "vitest";
import { cleanScore, displayNameFrom, mergeScores, statsFor, streakFromDays } from "../src/lib/account.js";
import { ago, parseRoute } from "../src/lib/route.js";

const TODAY = "2026-11-20";

describe("cleanScore", () => {
  it("accepts a real score and drops extra fields", () => {
    expect(cleanScore({ day: "2026-11-20", puzzleId: "a-b", moves: 3, score: 130, extra: "x" }, TODAY)).toEqual({
      day: "2026-11-20",
      puzzleId: "a-b",
      moves: 3,
      score: 130,
    });
  });

  it("accepts tomorrow (a timezone ahead) but not later", () => {
    expect(cleanScore({ day: "2026-11-21", puzzleId: "a-b", moves: 1, score: 150 }, TODAY)).not.toBeNull();
    expect(cleanScore({ day: "2026-11-22", puzzleId: "a-b", moves: 1, score: 150 }, TODAY)).toBeNull();
  });

  it("rejects points that do not match the moves, and bad shapes", () => {
    expect(cleanScore({ day: TODAY, puzzleId: "a-b", moves: 3, score: 131 }, TODAY)).toBeNull();
    expect(cleanScore({ day: TODAY, puzzleId: "../etc", moves: 3, score: 130 }, TODAY)).toBeNull();
    expect(cleanScore({ day: TODAY, puzzleId: "a".repeat(65), moves: 3, score: 130 }, TODAY)).toBeNull();
    expect(cleanScore({ day: TODAY, puzzleId: "a-b", moves: "3", score: 130 }, TODAY)).toBeNull();
    expect(cleanScore(undefined, TODAY)).toBeNull();
    expect(cleanScore([], TODAY)).toBeNull();
  });
});

describe("mergeScores", () => {
  it("keeps one score per puzzle and day, the better one, oldest first", () => {
    const merged = mergeScores(
      [{ day: "2026-11-19", puzzleId: "a-b", moves: 5, score: 110 }],
      [
        { day: "2026-11-19", puzzleId: "a-b", moves: 2, score: 140 },
        { day: "2026-11-18", puzzleId: "c-d", moves: 3, score: 130 },
      ],
    );
    expect(merged.map((entry) => [entry.day, entry.score])).toEqual([
      ["2026-11-18", 130],
      ["2026-11-19", 140],
    ]);
  });
});

describe("streaks and stats", () => {
  it("finds the latest run and the best run", () => {
    expect(streakFromDays(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-10", "2026-11-11"])).toEqual({
      count: 2,
      lastDay: "2026-11-11",
      best: 3,
    });
    expect(streakFromDays([])).toEqual({ count: 0, lastDay: null, best: 0 });
  });

  it("only shows a streak that reaches today or yesterday", () => {
    const entries = [
      { day: "2026-11-18", puzzleId: "a", moves: 1, score: 150 },
      { day: "2026-11-19", puzzleId: "b", moves: 1, score: 150 },
    ];
    expect(statsFor(entries, "2026-11-19").streak).toBe(2);
    expect(statsFor(entries, "2026-11-20").streak).toBe(2);
    expect(statsFor(entries, "2026-11-21").streak).toBe(0);
    expect(statsFor(entries, "2026-11-21")).toMatchObject({ bestStreak: 2, totalPoints: 300, wins: 2 });
  });
});

describe("displayNameFrom", () => {
  it("prefers the given name, strips odd characters and caps the length", () => {
    expect(displayNameFrom("Ada", "Ada Lovelace")).toBe("Ada");
    expect(displayNameFrom("", "Grace Hopper")).toBe("Grace");
    expect(displayNameFrom("A\u0000da\u200b", "")).toBe("Ada");
    expect(displayNameFrom("x".repeat(80), "")).toHaveLength(24);
    expect(displayNameFrom(undefined, undefined)).toBe("Player");
  });
});

describe("routes", () => {
  it("knows the account and friend pages", () => {
    const token = `${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}.${"A".repeat(22)}`;
    expect(parseRoute("/account")).toEqual({ name: "account" });
    expect(parseRoute("/account/")).toEqual({ name: "account" });
    expect(parseRoute(`/friend/${token}`)).toEqual({ name: "friend", token });
    expect(parseRoute("/friend/nope")).toEqual({ name: "friend", token: "" });
    expect(parseRoute("/privacy-policy")).toEqual({ name: "privacy" });
    expect(parseRoute("/")).toEqual({ name: "game" });
    expect(parseRoute("/anything-else")).toEqual({ name: "game" });
  });

  it("says how long ago in plain words", () => {
    const now = 1_000_000_000;
    expect(ago(now - 5_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(ago(now - 24 * 3_600_000, now)).toBe("yesterday");
  });
});
