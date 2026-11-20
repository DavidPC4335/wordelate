import { describe, expect, it } from "vitest";
import { float16BitsToFloat32, float32ToFloat16Bits } from "../src/index.js";

describe("float16", () => {
  it("encodes exact values to known binary16 bits", () => {
    expect(float32ToFloat16Bits(0)).toBe(0);
    expect(float32ToFloat16Bits(-0)).toBe(0x8000);
    expect(float32ToFloat16Bits(1)).toBe(0x3c00);
    expect(float32ToFloat16Bits(-1)).toBe(0xbc00);
    expect(float32ToFloat16Bits(2)).toBe(0x4000);
    expect(float32ToFloat16Bits(0.5)).toBe(0x3800);
    expect(float32ToFloat16Bits(65504)).toBe(0x7bff);
    expect(float32ToFloat16Bits(Number.POSITIVE_INFINITY)).toBe(0x7c00);
    expect(float32ToFloat16Bits(Number.NEGATIVE_INFINITY)).toBe(0xfc00);
  });

  it("decodes those bits back, including signed zero", () => {
    expect(float16BitsToFloat32(0)).toBe(0);
    expect(Object.is(float16BitsToFloat32(0x8000), -0)).toBe(true);
    expect(float16BitsToFloat32(0x3c00)).toBe(1);
    expect(float16BitsToFloat32(0xbc00)).toBe(-1);
    expect(float16BitsToFloat32(0x4000)).toBe(2);
    expect(float16BitsToFloat32(0x3800)).toBe(0.5);
    expect(float16BitsToFloat32(0x7bff)).toBe(65504);
    expect(float16BitsToFloat32(0x0001)).toBe(2 ** -24);
    expect(float16BitsToFloat32(0x7c00)).toBe(Number.POSITIVE_INFINITY);
    expect(float16BitsToFloat32(0xfc00)).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(float16BitsToFloat32(0x7e00))).toBe(true);
  });

  it("rounds ties to even", () => {
    // Halfway between 1 and the next float16. 1 has an even mantissa.
    expect(float32ToFloat16Bits(1 + 2 ** -11)).toBe(0x3c00);
    // Halfway between mantissas 1 and 2. 1 is odd, so the tie rounds up.
    expect(float32ToFloat16Bits(1 + 2 ** -10 + 2 ** -11)).toBe(0x3c02);
    // Subnormal ties: 1.25 * 2^-23 is halfway between mantissas 2 and 3.
    expect(float32ToFloat16Bits(1.25 * 2 ** -23)).toBe(0x0002);
    // 1.75 * 2^-23 is halfway between mantissas 3 and 4. 3 is odd.
    expect(float32ToFloat16Bits(1.75 * 2 ** -23)).toBe(0x0004);
    // Halfway between max finite float16 and the next binade rounds to inf.
    expect(float32ToFloat16Bits(65520)).toBe(0x7c00);
  });

  it("roundtrips ordinary magnitudes within a float16 ulp", () => {
    const samples = [0.1, -0.1, 0.3, 1.1, -2.5, 100, -100, 1e-4, 1000];
    for (const value of samples) {
      const back = float16BitsToFloat32(float32ToFloat16Bits(value));
      const abs = Math.abs(value);
      const tolerance = abs === 0 ? 0 : abs * 2 ** -10;
      expect(Math.abs(back - value)).toBeLessThanOrEqual(tolerance + 1e-6);
    }
    expect(Number.isNaN(float16BitsToFloat32(float32ToFloat16Bits(Number.NaN)))).toBe(
      true,
    );
  });
});
