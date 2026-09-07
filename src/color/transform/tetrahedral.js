/**
 * @fileoverview High-performance 3D and 4D Tetrahedral (Simplex) Interpolation Engine.
 * Eliminates tonal banding and artifacts inherent in standard trilinear interpolation.
 */

import { clamp } from '../../types/color.js';

/**
 * Evaluates 3D Tetrahedral Interpolation on a uniform CLUT grid.
 *
 * @param {Float32Array|Float64Array|number[]} lut Flattened CLUT array [gridX * gridY * gridZ * outChannels]
 * @param {number} gridPoints Number of grid points per dimension (e.g. 33)
 * @param {number} outChannels Number of output channels (e.g. 3 for Lab/XYZ, 4 for CMYK)
 * @param {number} x Normalized input channel 1 [0.0, 1.0]
 * @param {number} y Normalized input channel 2 [0.0, 1.0]
 * @param {number} z Normalized input channel 3 [0.0, 1.0]
 * @param {Float64Array|number[]} [outBuffer] Optional output buffer to receive interpolated channels
 * @returns {Float64Array} The interpolated output channel array
 */
export function interpolateTetrahedral3D(
  lut,
  gridPoints,
  outChannels,
  x,
  y,
  z,
  outBuffer = new Float64Array(outChannels)
) {
  const n = gridPoints;
  const maxIdx = n - 1;

  // Scale coordinates to grid index space
  const xs = clamp(x, 0.0, 1.0) * maxIdx;
  const ys = clamp(y, 0.0, 1.0) * maxIdx;
  const zs = clamp(z, 0.0, 1.0) * maxIdx;

  const i0 = Math.min(Math.floor(xs), maxIdx - 1);
  const j0 = Math.min(Math.floor(ys), maxIdx - 1);
  const k0 = Math.min(Math.floor(zs), maxIdx - 1);

  const i1 = i0 + 1;
  const j1 = j0 + 1;
  const k1 = k0 + 1;

  const dx = xs - i0;
  const dy = ys - j0;
  const dz = zs - k0;

  // Stride multipliers for flattened 3D array: index = ((x * n + y) * n + z) * outChannels
  const strideZ = outChannels;
  const strideY = n * strideZ;
  const strideX = n * strideY;

  // Helper to compute flat offset
  const base000 = i0 * strideX + j0 * strideY + k0 * strideZ;
  const offX = strideX;
  const offY = strideY;
  const offZ = strideZ;

  // Evaluate the 6 tetrahedral regions
  if (dx >= dy && dy >= dz) {
    // Region 1: dx >= dy >= dz
    // Vertices: P000, P100, P110, P111
    const p000 = base000;
    const p100 = base000 + offX;
    const p110 = base000 + offX + offY;
    const p111 = base000 + offX + offY + offZ;

    for (let c = 0; c < outChannels; c++) {
      const v000 = lut[p000 + c];
      const v100 = lut[p100 + c];
      const v110 = lut[p110 + c];
      const v111 = lut[p111 + c];
      outBuffer[c] = v000 + dx * (v100 - v000) + dy * (v110 - v100) + dz * (v111 - v110);
    }
  } else if (dx >= dz && dz >= dy) {
    // Region 2: dx >= dz >= dy
    // Vertices: P000, P100, P101, P111
    const p000 = base000;
    const p100 = base000 + offX;
    const p101 = base000 + offX + offZ;
    const p111 = base000 + offX + offY + offZ;

    for (let c = 0; c < outChannels; c++) {
      const v000 = lut[p000 + c];
      const v100 = lut[p100 + c];
      const v101 = lut[p101 + c];
      const v111 = lut[p111 + c];
      outBuffer[c] = v000 + dx * (v100 - v000) + dz * (v101 - v100) + dy * (v111 - v101);
    }
  } else if (dy >= dx && dx >= dz) {
    // Region 3: dy >= dx >= dz
    // Vertices: P000, P010, P110, P111
    const p000 = base000;
    const p010 = base000 + offY;
    const p110 = base000 + offY + offX;
    const p111 = base000 + offY + offX + offZ;

    for (let c = 0; c < outChannels; c++) {
      const v000 = lut[p000 + c];
      const v010 = lut[p010 + c];
      const v110 = lut[p110 + c];
      const v111 = lut[p111 + c];
      outBuffer[c] = v000 + dy * (v010 - v000) + dx * (v110 - v010) + dz * (v111 - v110);
    }
  } else if (dy >= dz && dz >= dx) {
    // Region 4: dy >= dz >= dx
    // Vertices: P000, P010, P011, P111
    const p000 = base000;
    const p010 = base000 + offY;
    const p011 = base000 + offY + offZ;
    const p111 = base000 + offY + offZ + offX;

    for (let c = 0; c < outChannels; c++) {
      const v000 = lut[p000 + c];
      const v010 = lut[p010 + c];
      const v011 = lut[p011 + c];
      const v111 = lut[p111 + c];
      outBuffer[c] = v000 + dy * (v010 - v000) + dz * (v011 - v010) + dx * (v111 - v011);
    }
  } else if (dz >= dx && dx >= dy) {
    // Region 5: dz >= dx >= dy
    // Vertices: P000, P001, P101, P111
    const p000 = base000;
    const p001 = base000 + offZ;
    const p101 = base000 + offZ + offX;
    const p111 = base000 + offZ + offX + offY;

    for (let c = 0; c < outChannels; c++) {
      const v000 = lut[p000 + c];
      const v001 = lut[p001 + c];
      const v101 = lut[p101 + c];
      const v111 = lut[p111 + c];
      outBuffer[c] = v000 + dz * (v001 - v000) + dx * (v101 - v001) + dy * (v111 - v101);
    }
  } else {
    // Region 6: dz >= dy >= dx
    // Vertices: P000, P001, P011, P111
    const p000 = base000;
    const p001 = base000 + offZ;
    const p011 = base000 + offZ + offY;
    const p111 = base000 + offZ + offY + offX;

    for (let c = 0; c < outChannels; c++) {
      const v000 = lut[p000 + c];
      const v001 = lut[p001 + c];
      const v011 = lut[p011 + c];
      const v111 = lut[p111 + c];
      outBuffer[c] = v000 + dz * (v001 - v000) + dy * (v011 - v001) + dx * (v111 - v011);
    }
  }

  return outBuffer;
}

/**
 * Evaluates 4D Simplex (generalized tetrahedral) Interpolation on a uniform 4-input CLUT grid.
 *
 * @param {Float32Array|Float64Array|number[]} lut Flattened 4D CLUT array
 * @param {number} gridPoints Number of grid points per dimension
 * @param {number} outChannels Number of output channels (e.g. 3 for Lab/XYZ)
 * @param {number} c1 Channel 1 normalized [0.0, 1.0]
 * @param {number} c2 Channel 2 normalized [0.0, 1.0]
 * @param {number} c3 Channel 3 normalized [0.0, 1.0]
 * @param {number} c4 Channel 4 normalized [0.0, 1.0]
 * @param {Float64Array|number[]} [outBuffer] Optional output buffer
 * @returns {Float64Array}
 */
export function interpolateSimplex4D(
  lut,
  gridPoints,
  outChannels,
  c1,
  c2,
  c3,
  c4,
  outBuffer = new Float64Array(outChannels)
) {
  const n = gridPoints;
  const maxIdx = n - 1;

  const inVals = [
    clamp(c1, 0.0, 1.0) * maxIdx,
    clamp(c2, 0.0, 1.0) * maxIdx,
    clamp(c3, 0.0, 1.0) * maxIdx,
    clamp(c4, 0.0, 1.0) * maxIdx,
  ];

  const i0 = [
    Math.min(Math.floor(inVals[0]), maxIdx - 1),
    Math.min(Math.floor(inVals[1]), maxIdx - 1),
    Math.min(Math.floor(inVals[2]), maxIdx - 1),
    Math.min(Math.floor(inVals[3]), maxIdx - 1),
  ];

  const deltas = [
    { dim: 0, d: inVals[0] - i0[0] },
    { dim: 1, d: inVals[1] - i0[1] },
    { dim: 2, d: inVals[2] - i0[2] },
    { dim: 3, d: inVals[3] - i0[3] },
  ];

  // Sort dimensions by descending fractional delta to determine 4-simplex traversal path
  deltas.sort((a, b) => b.d - a.d);

  // Strides for 4D indexing: (((d0 * n + d1) * n + d2) * n + d3) * outChannels
  const strides = [
    n * n * n * outChannels,
    n * n * outChannels,
    n * outChannels,
    outChannels,
  ];

  // Base vertex offset P0
  let currentOffset =
    i0[0] * strides[0] + i0[1] * strides[1] + i0[2] * strides[2] + i0[3] * strides[3];

  // Initialize output with base vertex values
  for (let c = 0; c < outChannels; c++) {
    outBuffer[c] = lut[currentOffset + c];
  }

  // Successively add directional difference vectors scaled by corresponding fractional deltas
  for (let s = 0; s < 4; s++) {
    const dim = deltas[s].dim;
    const delta = deltas[s].d;
    const nextOffset = currentOffset + strides[dim];

    for (let c = 0; c < outChannels; c++) {
      outBuffer[c] += delta * (lut[nextOffset + c] - lut[currentOffset + c]);
    }
    currentOffset = nextOffset;
  }

  return outBuffer;
}
