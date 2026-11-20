/** Symmetric per-vector int8. -128 is unused so the range stays symmetric. */
export type QuantizedVector = {
  q: Int8Array;
  scale: number;
};

export function quantizeSymmetric(v: Float32Array): QuantizedVector {
  let maxAbs = 0;
  for (let i = 0; i < v.length; i++) {
    const value = v[i] ?? 0;
    const abs = value < 0 ? -value : value;
    if (abs > maxAbs) maxAbs = abs;
  }
  const q = new Int8Array(v.length);
  if (maxAbs === 0) return { q, scale: 0 };
  const scale = maxAbs / 127;
  for (let i = 0; i < v.length; i++) {
    const value = v[i] ?? 0;
    let rounded = Math.round(value / scale);
    if (rounded > 127) rounded = 127;
    if (rounded < -127) rounded = -127;
    q[i] = rounded;
  }
  return { q, scale };
}

export function dequantize(q: Int8Array, scale: number): Float32Array {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) {
    out[i] = (q[i] ?? 0) * scale;
  }
  return out;
}

export function l2normalize(v: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const value = v[i] ?? 0;
    sum += value * value;
  }
  const norm = Math.sqrt(sum);
  if (norm === 0) return;
  for (let i = 0; i < v.length; i++) {
    v[i] = (v[i] ?? 0) / norm;
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosine length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function applyOp(
  position: Float32Array,
  vector: Float32Array,
  op: "+" | "-",
): Float32Array {
  if (position.length !== vector.length) {
    throw new Error(
      `applyOp length mismatch: ${position.length} vs ${vector.length}`,
    );
  }
  const sign = op === "+" ? 1 : -1;
  const out = new Float32Array(position.length);
  for (let i = 0; i < position.length; i++) {
    out[i] = (position[i] ?? 0) + sign * (vector[i] ?? 0);
  }
  return out;
}
