/**
 * IEEE binary16 encode/decode for one number.
 * Rounding is round-to-nearest, ties to even.
 */

const F16_SIGN = 0x8000;
const F16_EXP = 0x7c00;
const F16_INF = 0x7c00;
const F16_MAX_EXP = 0x1f;

export function float32ToFloat16Bits(n: number): number {
  const buf = new ArrayBuffer(4);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0] = n;
  const bits = u32[0] ?? 0;

  const sign = (bits >>> 16) & F16_SIGN;
  const exp = (bits >>> 23) & 0xff;
  const frac = bits & 0x7fffff;

  if (exp === 0xff) {
    if (frac === 0) return sign | F16_INF;
    const payload = frac >>> 13;
    return sign | F16_EXP | (payload === 0 ? 0x200 : payload);
  }

  // Unbiased exponent >= 16 does not fit in a finite float16.
  if (exp >= 143) return sign | F16_INF;

  // Below the smallest normal float16 (2^-14, float32 exp 113).
  if (exp <= 112) {
    // Halfway to the smallest subnormal (2^-24) is 2^-25 (exp 102, frac 0).
    // That tie rounds to even, which is zero. Anything smaller underflows.
    if (exp < 102 || (exp === 102 && frac === 0)) return sign;
    if (exp === 102) return sign | 1;

    const significand = (1 << 23) | frac;
    const shift = 126 - exp;
    let mant = significand >>> shift;
    const roundShift = shift - 1;
    const roundBit = (significand >>> roundShift) & 1;
    const sticky = (significand & ((1 << roundShift) - 1)) !== 0;
    if (roundBit === 1 && (sticky || (mant & 1) === 1)) mant += 1;
    // Carry out of the 10-bit field becomes the smallest normal, 2^-14.
    if (mant === 0x400) return sign | 0x0400;
    return sign | mant;
  }

  let mant = frac >>> 13;
  const rest = frac & 0x1fff;
  let newExp = exp - 112;
  if (rest > 0x1000 || (rest === 0x1000 && (mant & 1) === 1)) {
    mant += 1;
    if (mant === 0x400) {
      mant = 0;
      newExp += 1;
      if (newExp >= F16_MAX_EXP) return sign | F16_INF;
    }
  }
  return sign | (newExp << 10) | mant;
}

export function float16BitsToFloat32(bits: number): number {
  const u = bits & 0xffff;
  const signBit = u & F16_SIGN;
  const exp = (u >>> 10) & 0x1f;
  const mant = u & 0x3ff;
  const sign = signBit << 16;

  const outU = new Uint32Array(1);
  const outF = new Float32Array(outU.buffer);

  if (exp === 0) {
    if (mant === 0) {
      outU[0] = sign >>> 0;
      return outF[0] ?? 0;
    }
    // Subnormals are mant * 2^-24, all exactly representable in float32.
    const value = mant * 2 ** -24;
    return signBit !== 0 ? -value : value;
  }

  if (exp === F16_MAX_EXP) {
    outU[0] = (sign | 0x7f800000 | (mant << 13)) >>> 0;
    return outF[0] ?? Number.NaN;
  }

  const fExp = exp + 112;
  outU[0] = (sign | (fExp << 23) | (mant << 13)) >>> 0;
  return outF[0] ?? 0;
}
