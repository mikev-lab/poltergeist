import { test, describe } from 'node:test';
import assert from 'node:assert';
import { interpolateTetrahedral3D, interpolateSimplex4D } from '../../src/color/transform/tetrahedral.js';

describe('Tetrahedral & Simplex Multidimensional Interpolation', () => {
  // Construct a 3D identity grid: LUT[x, y, z] = [x_norm, y_norm, z_norm]
  const N3 = 5; // 5x5x5 grid
  const lut3D = new Float64Array(N3 * N3 * N3 * 3);
  for (let x = 0; x < N3; x++) {
    for (let y = 0; y < N3; y++) {
      for (let z = 0; z < N3; z++) {
        const idx = ((x * N3 + y) * N3 + z) * 3;
        lut3D[idx] = x / (N3 - 1);
        lut3D[idx + 1] = y / (N3 - 1);
        lut3D[idx + 2] = z / (N3 - 1);
      }
    }
  }

  test('3D Tetrahedral: Exact grid vertex match', () => {
    const out = new Float64Array(3);
    for (let x = 0; x < N3; x++) {
      for (let y = 0; y < N3; y++) {
        for (let z = 0; z < N3; z++) {
          const nx = x / (N3 - 1);
          const ny = y / (N3 - 1);
          const nz = z / (N3 - 1);
          interpolateTetrahedral3D(lut3D, N3, 3, nx, ny, nz, out);
          assert(Math.abs(out[0] - nx) < 1e-6);
          assert(Math.abs(out[1] - ny) < 1e-6);
          assert(Math.abs(out[2] - nz) < 1e-6);
        }
      }
    }
  });

  test('3D Tetrahedral: Linear identity preservation across all 6 tetrahedral regions', () => {
    // Select coordinates that specifically hit each of the 6 regions
    const testPoints = [
      [0.6, 0.4, 0.2], // dx >= dy >= dz (Region 1)
      [0.6, 0.2, 0.4], // dx >= dz >= dy (Region 2)
      [0.4, 0.6, 0.2], // dy >= dx >= dz (Region 3)
      [0.2, 0.6, 0.4], // dy >= dz >= dx (Region 4)
      [0.4, 0.2, 0.6], // dz >= dx >= dy (Region 5)
      [0.2, 0.4, 0.6], // dz >= dy >= dx (Region 6)
      [0.333, 0.333, 0.333], // equal deltas (simplex boundary)
    ];

    const out = new Float64Array(3);
    for (const [x, y, z] of testPoints) {
      interpolateTetrahedral3D(lut3D, N3, 3, x, y, z, out);
      assert(
        Math.abs(out[0] - x) < 1e-6,
        `X mismatch at (${x}, ${y}, ${z}): expected ${x}, got ${out[0]}`
      );
      assert(
        Math.abs(out[1] - y) < 1e-6,
        `Y mismatch at (${x}, ${y}, ${z}): expected ${y}, got ${out[1]}`
      );
      assert(
        Math.abs(out[2] - z) < 1e-6,
        `Z mismatch at (${x}, ${y}, ${z}): expected ${z}, got ${out[2]}`
      );
    }
  });

  test('3D Tetrahedral: Clamps out-of-bounds inputs safely', () => {
    const out = new Float64Array(3);
    interpolateTetrahedral3D(lut3D, N3, 3, -0.5, 1.5, 2.0, out);
    assert.strictEqual(out[0], 0.0);
    assert.strictEqual(out[1], 1.0);
    assert.strictEqual(out[2], 1.0);
  });

  // Construct a 4D identity grid: LUT[c1, c2, c3, c4] = [c1, c2, c3, c4]
  const N4 = 3; // 3x3x3x3 grid
  const lut4D = new Float64Array(N4 * N4 * N4 * N4 * 4);
  for (let c1 = 0; c1 < N4; c1++) {
    for (let c2 = 0; c2 < N4; c2++) {
      for (let c3 = 0; c3 < N4; c3++) {
        for (let c4 = 0; c4 < N4; c4++) {
          const idx = (((c1 * N4 + c2) * N4 + c3) * N4 + c4) * 4;
          lut4D[idx] = c1 / (N4 - 1);
          lut4D[idx + 1] = c2 / (N4 - 1);
          lut4D[idx + 2] = c3 / (N4 - 1);
          lut4D[idx + 3] = c4 / (N4 - 1);
        }
      }
    }
  }

  test('4D Simplex: Preserves identity interpolation across 4 channels', () => {
    const out = new Float64Array(4);
    const testPoints4D = [
      [0.0, 0.0, 0.0, 0.0],
      [1.0, 1.0, 1.0, 1.0],
      [0.2, 0.4, 0.6, 0.8],
      [0.75, 0.5, 0.25, 0.1],
    ];

    for (const [c1, c2, c3, c4] of testPoints4D) {
      interpolateSimplex4D(lut4D, N4, 4, c1, c2, c3, c4, out);
      assert(Math.abs(out[0] - c1) < 1e-6);
      assert(Math.abs(out[1] - c2) < 1e-6);
      assert(Math.abs(out[2] - c3) < 1e-6);
      assert(Math.abs(out[3] - c4) < 1e-6);
    }
  });
});
