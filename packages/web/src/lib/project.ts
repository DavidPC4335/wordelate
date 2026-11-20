/**
 * Fixed 3×300 projection for the optional path view.
 *
 * The basis is drawn once from a constant seed and then reused. Adding a move
 * must not move points that were already on the path, so this is not recomputed
 * from the current set of vectors.
 */

const AXES = 3;

/** Word vectors in this game are 300-dimensional. */
export const PROJECTION_DIMS = 300;

/** Constant seed. The same vector always lands on the same point. */
const PROJECTION_SEED = 0x5eed3d;

let cachedBasis: Float32Array | null = null;

export type Point3 = readonly [number, number, number];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}

/** Three orthonormal rows, row-major. The same array for the whole session. */
export function projectionBasis(): Float32Array {
  if (cachedBasis) return cachedBasis;
  const random = mulberry32(PROJECTION_SEED);
  const rows: Float64Array[] = [];
  for (let axis = 0; axis < AXES; axis++) {
    const row = new Float64Array(PROJECTION_DIMS);
    for (let i = 0; i < PROJECTION_DIMS; i++) row[i] = gaussian(random);
    for (const previous of rows) {
      let dot = 0;
      for (let i = 0; i < PROJECTION_DIMS; i++) dot += (row[i] ?? 0) * (previous[i] ?? 0);
      for (let i = 0; i < PROJECTION_DIMS; i++) row[i] = (row[i] ?? 0) - dot * (previous[i] ?? 0);
    }
    let norm = 0;
    for (let i = 0; i < PROJECTION_DIMS; i++) norm += (row[i] ?? 0) * (row[i] ?? 0);
    norm = Math.sqrt(norm);
    if (!Number.isFinite(norm) || norm === 0) {
      throw new Error("Projection basis collapsed");
    }
    for (let i = 0; i < PROJECTION_DIMS; i++) row[i] = (row[i] ?? 0) / norm;
    rows.push(row);
  }
  const basis = new Float32Array(AXES * PROJECTION_DIMS);
  for (let axis = 0; axis < AXES; axis++) {
    const row = rows[axis];
    if (!row) continue;
    for (let i = 0; i < PROJECTION_DIMS; i++) basis[axis * PROJECTION_DIMS + i] = row[i] ?? 0;
  }
  cachedBasis = basis;
  return basis;
}

/** Dot the vector with the three basis rows. Missing components count as zero. */
export function projectTo3(vector: ArrayLike<number>, basis: Float32Array = projectionBasis()): Point3 {
  const width = Math.min(vector.length, PROJECTION_DIMS);
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < width; i++) {
    const value = vector[i] ?? 0;
    x += value * (basis[i] ?? 0);
    y += value * (basis[PROJECTION_DIMS + i] ?? 0);
    z += value * (basis[2 * PROJECTION_DIMS + i] ?? 0);
  }
  return [x, y, z];
}
