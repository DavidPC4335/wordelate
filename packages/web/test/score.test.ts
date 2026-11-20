import { describe, expect, it } from "vitest";
import { calendarDay, nextStreak, scoreForMoves, streakAsOf } from "../src/lib/storage.js";

describe("scoreForMoves", () => {
  it("starts at 160 and drops by 10 per move, floored at 0", () => {
    expect(scoreForMoves(0)).toBe(160);
    expect(scoreForMoves(1)).toBe(150);
    expect(scoreForMoves(2)).toBe(140);
    expect(scoreForMoves(15)).toBe(10);
    expect(scoreForMoves(16)).toBe(0);
    expect(scoreForMoves(17)).toBe(0);
    expect(scoreForMoves(100)).toBe(0);
  });
});

describe("nextStreak", () => {
  it("increments when the win is the next calendar day", () => {
    expect(nextStreak({ count: 3, lastDay: "2026-11-18" }, "2026-11-19")).toEqual({
      count: 4,
      lastDay: "2026-11-19",
    });
    expect(nextStreak({ count: 2, lastDay: "2026-01-31" }, "2026-02-01")).toEqual({
      count: 3,
      lastDay: "2026-02-01",
    });
    expect(nextStreak({ count: 1, lastDay: "2024-02-28" }, "2024-02-29")).toEqual({
      count: 2,
      lastDay: "2024-02-29",
    });
  });

  it("does not increment on the same day", () => {
    const today = nextStreak({ count: 0, lastDay: null }, "2026-11-19");
    expect(today).toEqual({ count: 1, lastDay: "2026-11-19" });
    expect(nextStreak(today, "2026-11-19")).toEqual({ count: 1, lastDay: "2026-11-19" });
    expect(nextStreak({ count: 4, lastDay: "2026-11-19" }, "2026-11-19")).toEqual({
      count: 4,
      lastDay: "2026-11-19",
    });
  });

  it("resets to 1 when a day is missed", () => {
    expect(nextStreak({ count: 5, lastDay: "2026-11-17" }, "2026-11-19")).toEqual({
      count: 1,
      lastDay: "2026-11-19",
    });
    expect(nextStreak({ count: 8, lastDay: "2026-02-28" }, "2026-03-02")).toEqual({
      count: 1,
      lastDay: "2026-03-02",
    });
  });
});

describe("streakAsOf", () => {
  const saved = { count: 3, lastDay: "2026-11-18" };

  it("keeps the streak on the win day and the following day", () => {
    expect(streakAsOf(saved, "2026-11-18")).toBe(3);
    expect(streakAsOf(saved, "2026-11-19")).toBe(3);
  });

  it("reads a missed day as broken without changing the saved streak", () => {
    expect(streakAsOf(saved, "2026-11-20")).toBe(0);
    expect(saved).toEqual({ count: 3, lastDay: "2026-11-18" });
  });
});

describe("calendarDay", () => {
  it("uses America/New_York across Eastern standard and daylight time", () => {
    expect(calendarDay(new Date("2026-11-20T04:30:00.000Z"))).toBe("2026-11-19");
    expect(calendarDay(new Date("2026-11-20T05:00:00.000Z"))).toBe("2026-11-20");
    expect(calendarDay(new Date("2026-07-15T03:30:00.000Z"))).toBe("2026-07-14");
    expect(calendarDay(new Date("2026-07-15T04:00:00.000Z"))).toBe("2026-07-15");
  });
});
