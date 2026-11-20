import { describe, expect, it } from "vitest";
import { parseSignedEntry } from "../src/components/move-form.js";

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
