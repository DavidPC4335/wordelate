import { describe, expect, it } from "vitest";
import { PROJECTION_DIMS, projectTo3, projectionBasis } from "../src/lib/project.js";

function rowDot(basis: Float32Array, left: number, right: number): number {
  let sum = 0;
  for (let i = 0; i < PROJECTION_DIMS; i++) {
    sum += (basis[left * PROJECTION_DIMS + i] ?? 0) * (basis[right * PROJECTION_DIMS + i] ?? 0);
  }
  return sum;
}

describe("projection", () => {
  it("keeps a fixed point while a moved position lands elsewhere", () => {
    const start = new Float32Array(PROJECTION_DIMS);
    start[0] = 1;
    const moved = new Float32Array(start);
    moved[4] = 0.5;

    const first = projectTo3(start);
    const again = projectTo3(Float32Array.from(start));
    const elsewhere = projectTo3(moved);

    expect(again).toEqual(first);
    expect(elsewhere).not.toEqual(first);
    const gap = Math.hypot(elsewhere[0] - first[0], elsewhere[1] - first[1], elsewhere[2] - first[2]);
    expect(gap).toBeGreaterThan(1e-4);

    const extra = new Float32Array(PROJECTION_DIMS);
    extra[2] = 3;
    projectTo3(extra);
    expect(projectTo3(start)).toEqual(first);
  });

  it("uses one orthonormal basis for the session", () => {
    const basis = projectionBasis();
    expect(basis).toBe(projectionBasis());
    expect(basis.length).toBe(3 * PROJECTION_DIMS);
    expect(rowDot(basis, 0, 0)).toBeCloseTo(1, 4);
    expect(rowDot(basis, 1, 1)).toBeCloseTo(1, 4);
    expect(rowDot(basis, 2, 2)).toBeCloseTo(1, 4);
    expect(rowDot(basis, 0, 1)).toBeCloseTo(0, 4);
    expect(rowDot(basis, 0, 2)).toBeCloseTo(0, 4);
    expect(rowDot(basis, 1, 2)).toBeCloseTo(0, 4);
    expect(projectTo3(new Float32Array(PROJECTION_DIMS).fill(0), basis)).toEqual([0, 0, 0]);
  });
});
