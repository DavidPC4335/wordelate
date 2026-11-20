import { describe, expect, it } from "vitest";
import { LABEL_NEAR_DUPLICATE_CUTOFF, LABEL_WARM_SIMILARITY } from "../src/lib/game.js";
import { labelCount, labelRejected } from "../src/lib/labels.js";

describe("label filters", () => {
  it("rejects inflections of every input, including cats for cat", () => {
    expect(
      labelRejected({
        word: "cats",
        goalWord: "house",
        anchors: ["cat"],
        display: true,
        nearestAnchorCosine: 0.2,
        cutoff: LABEL_NEAR_DUPLICATE_CUTOFF,
      }),
    ).toBe(true);
    expect(
      labelRejected({
        word: "walking",
        goalWord: "swim",
        anchors: ["walk", "swimming"],
        display: true,
        nearestAnchorCosine: 0.2,
        cutoff: LABEL_NEAR_DUPLICATE_CUTOFF,
      }),
    ).toBe(true);
  });

  it("rejects a near-duplicate of one input and still allows the goal", () => {
    expect(LABEL_NEAR_DUPLICATE_CUTOFF).toBe(0.7);
    expect(
      labelRejected({
        word: "kitten",
        goalWord: "house",
        anchors: ["cat"],
        display: true,
        nearestAnchorCosine: 0.75,
        cutoff: 0.7,
      }),
    ).toBe(true);
    expect(
      labelRejected({
        word: "queen",
        goalWord: "queen",
        anchors: ["king", "woman"],
        display: true,
        nearestAnchorCosine: 0.8,
        cutoff: 0.7,
      }),
    ).toBe(false);
  });

  it("keeps labels inside the display vocabulary unless the word is the goal", () => {
    expect(
      labelRejected({
        word: "zyxt",
        goalWord: "queen",
        anchors: ["king"],
        display: false,
        nearestAnchorCosine: 0.1,
        cutoff: 0.7,
      }),
    ).toBe(true);
    expect(
      labelRejected({
        word: "queen",
        goalWord: "queen",
        anchors: ["king"],
        display: false,
        nearestAnchorCosine: 0.1,
        cutoff: 0.7,
      }),
    ).toBe(false);
  });

  it("shows one label while cold and three once warm", () => {
    expect(LABEL_WARM_SIMILARITY).toBe(0.45);
    expect(labelCount(0.44, 0.45)).toBe(1);
    expect(labelCount(0.45, 0.45)).toBe(3);
  });
});
