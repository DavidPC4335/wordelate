import { describe, expect, it } from "vitest";
import { isBannedOperand, isVariant, stem } from "../src/index.js";

describe("stem", () => {
  it("collapses a doubled consonant before ed", () => {
    expect(stem("stopped")).toBe("stop");
    expect(stem("stopping")).toBe("stop");
    expect(stem("running")).toBe("run");
  });

  it("strips a plural s without going below 3 letters", () => {
    expect(stem("deserts")).toBe("desert");
    expect(stem("red")).toBe("red");
    expect(stem("as")).toBe("as");
  });

  it("maps ies and ied back to y", () => {
    expect(stem("cities")).toBe("city");
    expect(stem("cries")).toBe("cry");
    expect(stem("cried")).toBe("cry");
  });

  it("does not strip a suffix that would leave fewer than 3 letters", () => {
    expect(stem("ties")).toBe("ties");
    expect(stem("bees")).toBe("bees");
  });
});

describe("isVariant", () => {
  it("treats plurals and participles as the same word", () => {
    expect(isVariant("cats", "cat")).toBe(true);
    expect(isVariant("kings", "king")).toBe(true);
    expect(isVariant("walking", "walk")).toBe(true);
    expect(isVariant("queen", "king")).toBe(false);
    expect(isVariant("kitten", "cat")).toBe(false);
  });
});

describe("isBannedOperand", () => {
  it("bans deserts when desert is the goal", () => {
    expect(isBannedOperand("deserts", "ocean", "desert", [])).toBe(true);
    expect(isBannedOperand("Deserts", "Ocean", "Desert", [])).toBe(true);
  });

  it("bans the exact start and goal and their stems", () => {
    expect(isBannedOperand("ocean", "ocean", "desert", [])).toBe(true);
    expect(isBannedOperand("desert", "ocean", "desert", [])).toBe(true);
    expect(isBannedOperand("stopped", "stop", "goal", [])).toBe(true);
    expect(isBannedOperand("cries", "cry", "goal", [])).toBe(true);
  });

  it("bans a listed irregular and does not ban a one-letter prefix", () => {
    expect(isBannedOperand("mice", "cat", "dog", ["mice"])).toBe(true);
    expect(isBannedOperand("start", "star", "goal", [])).toBe(false);
    expect(isBannedOperand("star", "start", "goal", [])).toBe(false);
    expect(isBannedOperand("catch", "cat", "dog", [])).toBe(false);
  });

  it("bans a direct listed suffix", () => {
    expect(isBannedOperand("cats", "cat", "dog", [])).toBe(true);
    expect(isBannedOperand("boxes", "box", "dog", [])).toBe(true);
    expect(isBannedOperand("testing", "test", "dog", [])).toBe(true);
  });
});
