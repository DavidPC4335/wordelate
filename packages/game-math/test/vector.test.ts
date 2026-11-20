import { describe, expect, it } from "vitest";
import {
  applyOp,
  cosine,
  dequantize,
  l2normalize,
  quantizeSymmetric,
} from "../src/index.js";

describe("quantizeSymmetric", () => {
  it("roundtrips a unit vector with a small cosine error", () => {
    const original = new Float32Array(300);
    for (let i = 0; i < original.length; i++) original[i] = Math.sin(i + 1);
    l2normalize(original);
    const before = Array.from(original);

    const { q, scale } = quantizeSymmetric(original);
    expect(scale).toBeGreaterThan(0);
    expect(Array.from(original)).toEqual(before);
    for (const code of q) {
      expect(code).toBeGreaterThanOrEqual(-127);
      expect(code).toBeLessThanOrEqual(127);
    }

    const back = dequantize(q, scale);
    expect(Math.abs(cosine(original, back) - 1)).toBeLessThan(1e-3);
  });

  it("uses scale 0 for an all-zero vector", () => {
    const zeros = new Float32Array(4);
    const { q, scale } = quantizeSymmetric(zeros);
    expect(scale).toBe(0);
    expect(Array.from(q)).toEqual([0, 0, 0, 0]);
    expect(Array.from(dequantize(q, scale))).toEqual([0, 0, 0, 0]);
  });

  it("scales from the peak absolute component and clamps to the symmetric range", () => {
    const v = new Float32Array([1, -2, 0.5]);
    const { q, scale } = quantizeSymmetric(v);
    expect(scale).toBeCloseTo(2 / 127);
    expect(q[1]).toBe(-127);
    expect(q[0]).toBe(Math.round(1 / scale));
    expect(q[2]).toBe(Math.round(0.5 / scale));
  });
});

describe("cosine", () => {
  it("is 1 for identical vectors", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosine(v, v)).toBe(1);
    const copy = new Float32Array(v);
    expect(cosine(v, copy)).toBe(1);
  });

  it("is 0 for orthogonal vectors and for a zero vector", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 0]))).toBe(0);
    expect(cosine(new Float32Array([0, 0]), new Float32Array([0, 0]))).toBe(0);
  });
});

describe("l2normalize", () => {
  it("normalizes in place and leaves a zero vector unchanged", () => {
    const v = new Float32Array([3, 4]);
    l2normalize(v);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);

    const zeros = new Float32Array([0, 0]);
    l2normalize(zeros);
    expect(Array.from(zeros)).toEqual([0, 0]);
  });
});

describe("applyOp", () => {
  it("returns a new array and does not mutate the inputs", () => {
    const position = new Float32Array([1, 2]);
    const vector = new Float32Array([10, 20]);
    const added = applyOp(position, vector, "+");
    const subtracted = applyOp(position, vector, "-");
    expect(Array.from(added)).toEqual([11, 22]);
    expect(Array.from(subtracted)).toEqual([-9, -18]);
    expect(Array.from(position)).toEqual([1, 2]);
    expect(Array.from(vector)).toEqual([10, 20]);
  });
});
