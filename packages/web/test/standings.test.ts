import { describe, expect, it } from "vitest";
import { bellPoint, betterThanPercent, cleanName, curveMarker, curvePlace, dayParts, isDayKey, normalZ, retentionStart, shiftDay } from "../src/lib/standings.js";

describe("board days", () => {
  it("keeps today and the six days before it", () => {
    expect(retentionStart("2026-11-20")).toBe("2026-11-14");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(isDayKey("2026-02-29")).toBe(false);
    expect(isDayKey("2024-02-29")).toBe(true);
  });
});

describe("betterThanPercent", () => {
  it("counts the players below you, and you", () => {
    // Rank 2 of 4 with two players below: three of four, so 75%.
    expect(betterThanPercent(2, 4)).toBe(75);
    expect(betterThanPercent(0, 4)).toBe(25);
    expect(betterThanPercent(3, 4)).toBe(100);
    expect(betterThanPercent(0, 1)).toBe(100);
    expect(betterThanPercent(1, 2)).toBe(100);
    expect(betterThanPercent(2, 3)).toBe(100);
    expect(betterThanPercent(0, 3)).toBe(33);
    expect(betterThanPercent(0, 0)).toBe(0);
  });
});

describe("curvePlace", () => {
  it("puts a tie in the middle of its band and a lone leader near the right", () => {
    expect(curvePlace(0, 2, 2)).toBe(50);
    expect(curvePlace(5, 1, 6)).toBe(92);
  });
});

describe("curveMarker", () => {
  it("puts the displayed percent on the bell, with 50 at the peak", () => {
    const mid = curveMarker(50);
    const low = curveMarker(25);
    const high = curveMarker(75);
    const peak = bellPoint(0);
    expect(mid.x).toBeCloseTo(peak.x, 4);
    expect(mid.y).toBeCloseTo(peak.y, 4);
    expect(low.x).toBeLessThan(mid.x);
    expect(high.x).toBeGreaterThan(mid.x);
    expect(low.y).toBeGreaterThan(mid.y);
    expect(high.y).toBeCloseTo(low.y, 4);
  });
});

describe("normalZ", () => {
  it("places the middle of a bell at zero and the usual tails near 2", () => {
    expect(normalZ(0.5)).toBeCloseTo(0, 6);
    expect(normalZ(0.975)).toBeCloseTo(1.959964, 4);
    expect(normalZ(0.025)).toBeCloseTo(-1.959964, 4);
  });
});

describe("cleanName", () => {
  it("keeps a short public name and drops anything else", () => {
    expect(cleanName("  Ada   Lovelace ")).toBe("Ada Lovelace");
    expect(cleanName("player-7")).toBe("player-7");
    expect(cleanName("O'Neil")).toBe("O'Neil");
    expect(cleanName("<b>ada</b>")).toBeNull();
    expect(cleanName("Ada; drop table")).toBeNull();
    expect(cleanName("Anonymous!")).toBeNull();
    expect(cleanName("José Ñandú")).toBe("José Ñandú");
    expect(cleanName("Zoë")).toBe("Zoë");
    expect(cleanName("ada 🔥")).toBeNull();
    expect(cleanName("ada\u202eevil")).toBeNull();
    expect(cleanName("  ")).toBeNull();
    expect(cleanName("a".repeat(25))).toBeNull();
  });
});

describe("dayParts", () => {
  it("labels today and past days for the day strip", () => {
    expect(dayParts("2026-11-20", "2026-11-20")).toEqual({ top: "Today", num: "20", long: "Friday, Nov 20" });
    expect(dayParts("2026-11-19", "2026-11-20")).toEqual({ top: "Thu", num: "19", long: "Thursday, Nov 19" });
  });

  it("falls back to the raw text for a bad day", () => {
    expect(dayParts("nope", "2026-11-20").top).toBe("nope");
  });
});
