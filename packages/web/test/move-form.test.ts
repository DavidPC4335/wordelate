import { describe, expect, it } from "vitest";
import { parseSignedEntry, prepareEntry } from "../src/components/move-form.js";
import { closestWord } from "../src/lib/pack.js";
import type { Pack } from "../src/lib/pack.js";

function packOf(words: readonly string[]): Pack {
  return {
    words: [...words],
    rows: words.map(() => new Float32Array()),
    index: new Map(words.map((word, index) => [word, index])),
    display: new Uint8Array(words.length).fill(1),
  };
}

describe("parseSignedEntry", () => {
  it("adds a plain word on enter and uses the button when there is no sign", () => {
    expect(parseSignedEntry("dog", "add")).toEqual({ op: "add", word: "dog" });
    expect(parseSignedEntry("  cat  ", "subtract")).toEqual({ op: "subtract", word: "cat" });
  });

  it("lets a typed plus add even when the minus button is clicked", () => {
    expect(parseSignedEntry("+dog", "subtract")).toEqual({ op: "add", word: "dog" });
    expect(parseSignedEntry("+ dog", "add")).toEqual({ op: "add", word: "dog" });
    expect(parseSignedEntry("  +  dog  ", "subtract")).toEqual({ op: "add", word: "dog" });
  });

  it("lets a typed minus subtract even when the plus button is clicked", () => {
    expect(parseSignedEntry("-cat", "add")).toEqual({ op: "subtract", word: "cat" });
    expect(parseSignedEntry("−cat", "add")).toEqual({ op: "subtract", word: "cat" });
    expect(parseSignedEntry("- cat", "subtract")).toEqual({ op: "subtract", word: "cat" });
    expect(parseSignedEntry("  −  cat  ", "add")).toEqual({ op: "subtract", word: "cat" });
  });

  it("leaves an empty word after a bare sign so the form can report a missing word", () => {
    expect(parseSignedEntry("+", "subtract")).toEqual({ op: "add", word: "" });
    expect(parseSignedEntry("-", "add")).toEqual({ op: "subtract", word: "" });
    expect(parseSignedEntry("−", "add")).toEqual({ op: "subtract", word: "" });
    expect(parseSignedEntry("   ", "add")).toEqual({ op: "add", word: "" });
  });
});

describe("prepareEntry", () => {
  const pack = packOf(["dog", "cat"]);
  const resolve = (word: string) => {
    const found = closestWord(pack, word);
    return found ?? word;
  };

  it("submits an exact word on the first press", () => {
    expect(prepareEntry("dog", "add", resolve)).toEqual({ action: "submit", op: "add", word: "dog" });
    expect(prepareEntry("DOG", "subtract", resolve)).toEqual({ action: "submit", op: "subtract", word: "dog" });
  });

  it("holds a corrected spelling and keeps a typed sign", () => {
    expect(prepareEntry("dag", "add", resolve)).toEqual({ action: "correct", value: "dog", from: "dag", to: "dog" });
    expect(prepareEntry("+dag", "subtract", resolve)).toEqual({ action: "correct", value: "+dog", from: "dag", to: "dog" });
    expect(prepareEntry("−cta", "add", resolve)).toEqual({ action: "correct", value: "−cat", from: "cta", to: "cat" });
  });

  it("submits the corrected word on the next press", () => {
    const first = prepareEntry("dag", "subtract", resolve);
    expect(first.action).toBe("correct");
    if (first.action !== "correct") return;
    expect(prepareEntry(first.value, "subtract", resolve)).toEqual({ action: "submit", op: "subtract", word: "dog" });
  });

  it("still submits an empty or unknown word so the form can report it", () => {
    expect(prepareEntry("   ", "add", resolve)).toEqual({ action: "submit", op: "add", word: "" });
    expect(prepareEntry("zzzzzzzzzz", "add", resolve)).toEqual({ action: "submit", op: "add", word: "zzzzzzzzzz" });
  });
});

describe("closestWord", () => {
  const pack = packOf(["at", "bat", "cat", "catalog", "dog", "kit"]);

  it("keeps an exact vocabulary word", () => {
    expect(closestWord(pack, "dog")).toBe("dog");
    expect(closestWord(pack, "DOG")).toBe("dog");
  });

  it("corrects a one-letter typo to the nearest vocabulary word", () => {
    expect(closestWord(pack, "dag")).toBe("dog");
  });

  it("sees the word after the form strips a signed prefix", () => {
    expect(parseSignedEntry("+dgo", "subtract")).toEqual({ op: "add", word: "dgo" });
    expect(closestWord(pack, parseSignedEntry("+dgo", "subtract").word)).toBe("dog");
  });

  it("prefers a shared prefix, then a shorter word, when distances tie", () => {
    expect(closestWord(pack, "kat")).toBe("kit");
    expect(closestWord(pack, "xat")).toBe("at");
  });

  it("returns null when no vocabulary word is a similar length", () => {
    expect(closestWord(pack, "")).toBeNull();
    expect(closestWord(pack, "zzzzzzzzzz")).toBeNull();
  });
});
