import { isVariant } from "@wordelate/game-math";

export function labelCount(goalSimilarity: number, warmSimilarity: number): number {
  return goalSimilarity >= warmSimilarity ? 3 : 1;
}

/**
 * True when a vocabulary row must not be shown as a label.
 * The goal itself is allowed past the display-vocab flag and the near-duplicate
 * cutoff, so a real answer can still surface. Inflections of an input never can.
 */
export function labelRejected(input: {
  word: string;
  goalWord: string;
  anchors: readonly string[];
  display: boolean;
  nearestAnchorCosine: number;
  cutoff: number;
}): boolean {
  const word = input.word.toLowerCase();
  const goal = input.goalWord.toLowerCase();
  if (input.anchors.some((anchor) => isVariant(word, anchor))) return true;
  if (!input.display && word !== goal) return true;
  if (word !== goal && input.nearestAnchorCosine > input.cutoff) return true;
  return false;
}
