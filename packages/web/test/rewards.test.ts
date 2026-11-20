import { describe, expect, it } from "vitest";
import {
  COSMETICS,
  DEFAULT_COSMETIC,
  EARNABLE,
  earnedIds,
  heatColor,
  heatLabel,
  isEarned,
  nextReward,
  ratingFor,
  unlockProgress,
} from "../src/lib/rewards.js";
import {
  HOWTO_SEEN_KEY,
  SCORES_KEY,
  currentRewardStats,
  hasGameHistory,
  readBestStreak,
  readHowToSeen,
  readLook,
  readUnlocked,
  recordWin,
  saveGame,
  storageRemove,
  storageSet,
  syncUnlocked,
  unlockAllLooks,
  writeHowToSeen,
  writeLook,
} from "../src/lib/storage.js";

function wipe() {
  for (const key of [
    SCORES_KEY,
    HOWTO_SEEN_KEY,
    "wordelate.streak",
    "wordelate.bestStreak",
    "wordelate.unlocked",
    "wordelate.look",
    "wordelate.game.a-b",
    "wordelate.game.c-d",
  ]) {
    storageRemove(key);
  }
}

describe("cosmetics", () => {
  it("offers eight earnable looks plus one free default", () => {
    expect(EARNABLE).toHaveLength(8);
    expect(COSMETICS.filter((item) => item.unlock.kind === "free")).toHaveLength(1);
    expect(COSMETICS[0]?.id).toBe(DEFAULT_COSMETIC);
  });

  it("uses both streaks and scores as unlock rules", () => {
    const kinds = new Set(EARNABLE.map((item) => item.unlock.kind));
    expect(kinds.has("points")).toBe(true);
    expect(kinds.has("streak")).toBe(true);
  });

  it("unlocks at the exact threshold and not a point sooner", () => {
    const sunset = EARNABLE.find((item) => item.id === "sunset");
    const neon = EARNABLE.find((item) => item.id === "neon");
    const aurora = EARNABLE.find((item) => item.id === "aurora");
    if (!sunset || !neon || !aurora) throw new Error("missing cosmetic");
    expect(isEarned(sunset, { totalPoints: 299, bestStreak: 0 })).toBe(false);
    expect(isEarned(sunset, { totalPoints: 300, bestStreak: 0 })).toBe(true);
    expect(isEarned(neon, { totalPoints: 9999, bestStreak: 2 })).toBe(false);
    expect(isEarned(neon, { totalPoints: 0, bestStreak: 3 })).toBe(true);
    expect(isEarned(aurora, { totalPoints: 0, bestStreak: 6 })).toBe(false);
    expect(isEarned(aurora, { totalPoints: 0, bestStreak: 7 })).toBe(true);
  });

  it("always includes the default", () => {
    expect(earnedIds({ totalPoints: 0, bestStreak: 0 })).toEqual(["classic"]);
    expect(earnedIds({ totalPoints: 300, bestStreak: 7 })).toEqual(["classic", "sunset", "neon", "aurora"]);
    expect(earnedIds({ totalPoints: 5000, bestStreak: 30 })).toHaveLength(COSMETICS.length);
  });

  it("makes each later look harder to earn than the ones before it", () => {
    const points = EARNABLE.filter((item) => item.unlock.kind === "points").map((item) =>
      item.unlock.kind === "points" ? item.unlock.target : 0,
    );
    const streaks = EARNABLE.filter((item) => item.unlock.kind === "streak").map((item) =>
      item.unlock.kind === "streak" ? item.unlock.target : 0,
    );
    expect(points).toEqual([...points].sort((a, b) => a - b));
    expect(streaks).toEqual([...streaks].sort((a, b) => a - b));
    expect(new Set(points).size).toBe(points.length);
    expect(new Set(streaks).size).toBe(streaks.length);
  });

  it("gives the five newest looks textures or moving parts", () => {
    for (const id of ["candy", "abyss", "galaxy", "disco", "holiday"]) {
      const fx = COSMETICS.find((item) => item.id === id)?.look.fx;
      expect(fx?.backdrop).toBeDefined();
      expect(fx?.skin).toBeDefined();
      expect(fx?.tube).toBeDefined();
      expect(fx?.drift?.count).toBeGreaterThan(0);
    }
  });

  it("reports progress and caps it at the target", () => {
    const sunset = COSMETICS.find((item) => item.id === "sunset");
    if (!sunset) throw new Error("missing cosmetic");
    const half = unlockProgress(sunset, { totalPoints: 150, bestStreak: 0 });
    expect(half.ratio).toBe(0.5);
    expect(half.label).toBe("150 / 300 points");
    expect(half.remaining).toBe("150 points to go");
    const over = unlockProgress(sunset, { totalPoints: 900, bestStreak: 0 });
    expect(over.ratio).toBe(1);
    expect(over.label).toBe("300 / 300 points");
  });

  it("points at the closest locked look", () => {
    const close = nextReward({ totalPoints: 270, bestStreak: 0 });
    expect(close?.cosmetic.id).toBe("sunset");
    const streaky = nextReward({ totalPoints: 300, bestStreak: 2 });
    expect(streaky?.cosmetic.id).toBe("neon");
    expect(nextReward({ totalPoints: 300, bestStreak: 7 })?.cosmetic.id).toBe("abyss");
    expect(nextReward({ totalPoints: 5000, bestStreak: 30 })).toBeNull();
  });

  it("gives every look a full palette", () => {
    for (const item of COSMETICS) {
      expect(item.look.sky).toHaveLength(4);
      expect(item.look.sparks.length).toBeGreaterThan(2);
      expect(item.look.start).toMatch(/^#[0-9a-f]{6}$/i);
      expect(item.look.goal).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("ratingFor", () => {
  it("gives three stars at or under par", () => {
    expect(ratingFor(3, 3)).toEqual({ stars: 3, title: "Perfect!" });
    expect(ratingFor(2, 3).stars).toBe(3);
    expect(ratingFor(2, 3).title).toBe("Beat par!");
  });

  it("gives two stars within two moves and one beyond", () => {
    expect(ratingFor(4, 3).stars).toBe(2);
    expect(ratingFor(5, 3).stars).toBe(2);
    expect(ratingFor(6, 3).stars).toBe(1);
  });

  it("falls back to three moves when par is unknown", () => {
    expect(ratingFor(3, null).stars).toBe(3);
    expect(ratingFor(5, null).stars).toBe(2);
    expect(ratingFor(4, 0).stars).toBe(2);
  });
});

describe("heat", () => {
  it("runs from ice cold to burning and calls a win a win", () => {
    expect(heatLabel(0, false)).toBe("Ice cold");
    expect(heatLabel(0.3, false)).toBe("Cool");
    expect(heatLabel(0.7, false)).toBe("Hot");
    expect(heatLabel(0.95, false)).toBe("Burning");
    expect(heatLabel(1, false)).toBe("Burning");
    expect(heatLabel(0.2, true)).toBe("Got it!");
    expect(heatLabel(Number.NaN, false)).toBe("Ice cold");
  });

  it("blends between blue and red and clamps outside 0 to 1", () => {
    expect(heatColor(0)).toBe("rgb(74, 168, 255)");
    expect(heatColor(1)).toBe("rgb(255, 77, 109)");
    expect(heatColor(-5)).toBe(heatColor(0));
    expect(heatColor(5)).toBe(heatColor(1));
    expect(heatColor(0.5)).not.toBe(heatColor(0.2));
  });
});

describe("reward storage", () => {
  it("reports no history for a fresh browser and an opened but untouched puzzle", () => {
    wipe();
    expect(hasGameHistory()).toBe(false);
    saveGame("a-b", { moves: [], gaveUp: false });
    expect(hasGameHistory()).toBe(false);
  });

  it("reports history after a move, a give up, or a score", () => {
    wipe();
    saveGame("a-b", { moves: [{ op: "+", word: "x" }], gaveUp: false });
    expect(hasGameHistory()).toBe(true);
    wipe();
    saveGame("c-d", { moves: [], gaveUp: true });
    expect(hasGameHistory()).toBe(true);
    wipe();
    storageSet(SCORES_KEY, JSON.stringify([{ puzzleId: "a-b", moves: 2, score: 140, day: "2026-11-19" }]));
    expect(hasGameHistory()).toBe(true);
    wipe();
  });

  it("remembers that the tutorial was seen", () => {
    wipe();
    expect(readHowToSeen()).toBe(false);
    writeHowToSeen();
    expect(readHowToSeen()).toBe(true);
    wipe();
  });

  it("tracks the best streak and returns the points earned", () => {
    wipe();
    const first = recordWin({ puzzleId: "a-b", moves: 3, day: "2026-11-18" });
    expect(first.earned).toBe(130);
    expect(first.bestStreak).toBe(1);
    const second = recordWin({ puzzleId: "c-d", moves: 2, day: "2026-11-19" });
    expect(second.bestStreak).toBe(2);
    const gap = recordWin({ puzzleId: "a-b", moves: 4, day: "2026-11-25" });
    expect(gap.streak.count).toBe(1);
    expect(gap.bestStreak).toBe(2);
    expect(readBestStreak()).toBe(2);
    wipe();
  });

  it("unlocks a look once and keeps it after the streak resets", () => {
    wipe();
    const stats = { totalPoints: 100, bestStreak: 3 };
    const first = syncUnlocked(stats);
    expect(first.fresh).toEqual(["neon"]);
    expect(first.unlocked).toContain("neon");
    const again = syncUnlocked(stats);
    expect(again.fresh).toEqual([]);
    const later = syncUnlocked({ totalPoints: 100, bestStreak: 0 });
    expect(later.unlocked).toContain("neon");
    expect(readUnlocked()).toContain("neon");
    wipe();
  });

  it("lets the admin unlock every look at once, and they stay unlocked", () => {
    wipe();
    const all = unlockAllLooks();
    expect(all).toHaveLength(COSMETICS.length);
    expect(readUnlocked()).toEqual(all);
    const later = syncUnlocked({ totalPoints: 0, bestStreak: 0 });
    expect(later.unlocked).toHaveLength(COSMETICS.length);
    expect(later.fresh).toEqual([]);
    wipe();
  });

  it("only equips a look that is unlocked", () => {
    wipe();
    writeLook("aurora");
    expect(readLook(["classic"])).toBe("classic");
    expect(readLook(["classic", "aurora"])).toBe("aurora");
    storageSet("wordelate.look", "not-a-look");
    expect(readLook(["classic", "aurora"])).toBe("classic");
    wipe();
  });

  it("builds reward stats from the saved scores and streak", () => {
    wipe();
    const stats = currentRewardStats(
      [{ puzzleId: "a-b", moves: 3, score: 130, day: "2026-11-19" }],
      { count: 2, lastDay: "2026-11-19" },
    );
    expect(stats).toEqual({ totalPoints: 130, bestStreak: 2 });
    wipe();
  });
});
