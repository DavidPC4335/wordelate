import { describe, expect, it } from "vitest";
import type { TopPlayersView } from "../src/lib/admin.js";
import { cardFileName, ordinal, windowTitle, withoutHidden } from "../src/lib/top-card.js";

function view(): TopPlayersView {
  const bestDay = { day: "2026-11-24", score: 150, moves: 1, start: "king", goal: "queen", steps: [{ op: "+" as const, word: "woman" }] };
  return {
    days: 7,
    from: "2026-11-20",
    to: "2026-11-26",
    players: ["Ana", "Bo", "Cy"].map((name, index) => ({ place: index + 1, name, picture: null, totalPoints: 300 - index * 10, daysPlayed: 3, bestDay })),
  };
}

describe("top player cards", () => {
  it("leaves hidden players out and moves the rest up", () => {
    const original = view();
    const shown = withoutHidden(original, new Set([1]));
    expect(shown.players.map((player) => [player.place, player.name])).toEqual([
      [1, "Bo"],
      [2, "Cy"],
    ]);
    expect(original.players[1]?.place).toBe(2);
    expect(withoutHidden(original, new Set()).players).toHaveLength(3);
  });

  it("names the window, the place and the file", () => {
    expect(windowTitle(7)).toBe("Players of the week");
    expect(windowTitle(30)).toBe("Players of the month");
    expect(windowTitle(90)).toBe("Players of the quarter");
    expect([1, 2, 3, 4, 11, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "22nd"]);
    expect(cardFileName(view(), { place: 2, name: "Zoë O'Neil!" })).toBe("wordelate-top-7d-2026-11-26-2-zoe-o-neil.png");
  });
});
