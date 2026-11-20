import { describe, expect, it } from "vitest";
import { betterThanPercent, cleanName, curvePlace, isDayKey, normalZ, retentionStart, shiftDay } from "../src/lib/standings.js";

describe("board days", () => {
  it("keeps today and the six days before it", () => {
    expect(retentionStart("2026-11-20")).toBe("2026-11-14");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(isDayKey("2026-02-29")).toBe(false);
    expect(isDayKey("2024-02-29")).toBe(true);
  });
});

describe("betterThanPercent", () => {
  it("counts only players with a lower score", () => {
    expect(betterThanPercent(0, 4)).toBe(0);
    expect(betterThanPercent(1, 2)).toBe(50);
    expect(betterThanPercent(2, 3)).toBe(66);
    expect(betterThanPercent(999, 1000)).toBe(99);
  });
});

describe("curvePlace", () => {
  it("puts a tie in the middle of its band and a lone leader near the right", () => {
    expect(curvePlace(0, 2, 2)).toBe(50);
    expect(curvePlace(5, 1, 6)).toBe(92);
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
    expect(cleanName("  ")).toBeNull();
    expect(cleanName("a".repeat(25))).toBeNull();
  });
});
