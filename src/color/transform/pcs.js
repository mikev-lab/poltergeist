/**
 * @fileoverview Profile Connection Space (PCS) coordinate transformations.
 * Implements standard CIE 1976 L*a*b* <-> CIEXYZ under D50 illuminant,
 * and Bradford chromatic adaptation matrices.
 */

import { XyzColor, LabColor, D50 } from '../../types/color.js';

// CIE Standard constants
const CIE_EPSILON = 216.0 / 24389.0; // ~0.00885645
const CIE_KAPPA = 24389.0 / 27.0;    // ~903.296296

/**
 * Standard D65 white point illuminant coordinates.
 */
export const D65 = Object.freeze({
  X: 0.95047,
  Y: 1.00000,
  Z: 1.08883,
});

/**
 * Forward CIE cube-root transfer function.
 * @param {number} t
 * @returns {number}
 */
function f(t) {
  return t > CIE_EPSILON ? Math.cbrt(t) : (CIE_KAPPA * t + 16.0) / 116.0;
}

/**
 * Inverse CIE cube-root transfer function.
 * @param {number} t
 * @returns {number}
 */
function fInv(t) {
  const t3 = t * t * t;
  return t3 > CIE_EPSILON ? t3 : (116.0 * t - 16.0) / CIE_KAPPA;
}

/**
 * Converts CIEXYZ coordinates to CIELAB relative to D50 white point.
 * @param {XyzColor} xyz
 * @param {{X: number, Y: number, Z: number}} [whitePoint=D50]
 * @returns {LabColor}
 */
export function xyzToLab(xyz, whitePoint = D50) {
  const xr = xyz.x / whitePoint.X;
  const yr = xyz.y / whitePoint.Y;
  const zr = xyz.z / whitePoint.Z;

  const fx = f(xr);
  const fy = f(yr);
  const fz = f(zr);

  const l = 116.0 * fy - 16.0;
  const a = 500.0 * (fx - fy);
  const b = 200.0 * (fy - fz);

  return new LabColor(l, a, b);
}

/**
 * Converts CIELAB coordinates to CIEXYZ relative to D50 white point.
 * @param {LabColor} lab
 * @param {{X: number, Y: number, Z: number}} [whitePoint=D50]
 * @returns {XyzColor}
 */
export function labToXyz(lab, whitePoint = D50) {
  const fy = (lab.l + 16.0) / 116.0;
  const fx = lab.a / 500.0 + fy;
  const fz = fy - lab.b / 200.0;

  const xr = fInv(fx);
  const yr = fInv(fy);
  const zr = fInv(fz);

  return new XyzColor(xr * whitePoint.X, yr * whitePoint.Y, zr * whitePoint.Z);
}

/**
 * Bradford 3x3 cone response matrix.
 */
const M_BRADFORD = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];

/**
 * Inverse Bradford 3x3 matrix.
 */
const M_BRADFORD_INV = [
  [0.9869929, -0.1470543, 0.1599627],
  [0.4323053, 0.5183603, 0.0492912],
  [-0.0085287, 0.0400428, 0.9684867],
];

/**
 * Multiplies a 3x3 matrix with a 3-element vector.
 * @param {number[][]} m
 * @param {number[]} v
 * @returns {number[]}
 */
function mat3MulVec3(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/**
 * Computes the 3x3 chromatic adaptation matrix from source to target white point using Bradford transform.
 * @param {{X: number, Y: number, Z: number}} srcWp
 * @param {{X: number, Y: number, Z: number}} dstWp
 * @returns {number[][]}
 */
export function computeBradfordMatrix(srcWp, dstWp) {
  const srcCone = mat3MulVec3(M_BRADFORD, [srcWp.X, srcWp.Y, srcWp.Z]);
  const dstCone = mat3MulVec3(M_BRADFORD, [dstWp.X, dstWp.Y, dstWp.Z]);

  const scale = [
    dstCone[0] / srcCone[0],
    dstCone[1] / srcCone[1],
    dstCone[2] / srcCone[2],
  ];

  // M_result = M_BRADFORD_INV * diag(scale) * M_BRADFORD
  const scaledBfd = [
    [M_BRADFORD[0][0] * scale[0], M_BRADFORD[0][1] * scale[0], M_BRADFORD[0][2] * scale[0]],
    [M_BRADFORD[1][0] * scale[1], M_BRADFORD[1][1] * scale[1], M_BRADFORD[1][2] * scale[1]],
    [M_BRADFORD[2][0] * scale[2], M_BRADFORD[2][1] * scale[2], M_BRADFORD[2][2] * scale[2]],
  ];

  const result = [];
  for (let r = 0; r < 3; r++) {
    result[r] = [];
    for (let c = 0; c < 3; c++) {
      result[r][c] =
        M_BRADFORD_INV[r][0] * scaledBfd[0][c] +
        M_BRADFORD_INV[r][1] * scaledBfd[1][c] +
        M_BRADFORD_INV[r][2] * scaledBfd[2][c];
    }
  }
  return result;
}

// Precomputed D65 -> D50 Bradford adaptation matrix
export const BRADFORD_D65_TO_D50 = Object.freeze(computeBradfordMatrix(D65, D50));

// Precomputed D50 -> D65 Bradford adaptation matrix
export const BRADFORD_D50_TO_D65 = Object.freeze(computeBradfordMatrix(D50, D65));

/**
 * Adapts CIEXYZ coordinates between white points using a 3x3 transformation matrix.
 * @param {XyzColor} xyz
 * @param {number[][]} matrix
 * @returns {XyzColor}
 */
export function adaptXyz(xyz, matrix) {
  const res = mat3MulVec3(matrix, [xyz.x, xyz.y, xyz.z]);
  return new XyzColor(res[0], res[1], res[2]);
}
