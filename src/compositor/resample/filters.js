/**
 * @file filters.js
 * @description 1D convolution kernels for prepress image resampling in Poltergeist.
 * Includes Box, Bilinear, Bicubic (Catmull-Rom & Mitchell-Netravali), and Lanczos-3.
 */

export const ResampleFilter = Object.freeze({
  BOX: 'BOX',
  BILINEAR: 'BILINEAR',
  BICUBIC_CATMULL_ROM: 'BICUBIC_CATMULL_ROM',
  BICUBIC_MITCHELL: 'BICUBIC_MITCHELL',
  LANCZOS3: 'LANCZOS3'
});

/**
 * Filter definition containing radius and kernel evaluator function.
 */
export class FilterKernel {
  /**
   * @param {string} name 
   * @param {number} radius 
   * @param {function(number): number} fn 
   */
  constructor(name, radius, fn) {
    this.name = name;
    this.radius = radius;
    this.fn = fn;
    Object.freeze(this);
  }
}

/**
 * Box filter (nearest neighbor).
 */
export const BoxFilter = new FilterKernel(ResampleFilter.BOX, 0.5, (x) => {
  const ax = Math.abs(x);
  return ax <= 0.5 ? 1.0 : 0.0;
});

/**
 * Bilinear filter (triangle).
 */
export const BilinearFilter = new FilterKernel(ResampleFilter.BILINEAR, 1.0, (x) => {
  const ax = Math.abs(x);
  return ax < 1.0 ? 1.0 - ax : 0.0;
});

/**
 * General cubic filter parameterized by B and C.
 * @param {number} B 
 * @param {number} C 
 * @returns {function(number): number}
 */
function createCubicKernel(B, C) {
  const p0 = (6.0 - 2.0 * B) / 6.0;
  const p2 = (-18.0 + 12.0 * B + 6.0 * C) / 6.0;
  const p3 = (12.0 - 9.0 * B - 6.0 * C) / 6.0;
  const q0 = (8.0 * B + 24.0 * C) / 6.0;
  const q1 = (-12.0 * B - 48.0 * C) / 6.0;
  const q2 = (6.0 * B + 30.0 * C) / 6.0;
  const q3 = (-B - 6.0 * C) / 6.0;

  return (x) => {
    const ax = Math.abs(x);
    if (ax < 1.0) {
      return p0 + ax * ax * (p2 + ax * p3);
    } else if (ax < 2.0) {
      return q0 + ax * (q1 + ax * (q2 + ax * q3));
    }
    return 0.0;
  };
}

/**
 * Catmull-Rom Bicubic filter (B=0, C=0.5).
 */
export const BicubicCatmullRomFilter = new FilterKernel(
  ResampleFilter.BICUBIC_CATMULL_ROM,
  2.0,
  createCubicKernel(0.0, 0.5)
);

/**
 * Mitchell-Netravali Bicubic filter (B=1/3, C=1/3).
 */
export const BicubicMitchellFilter = new FilterKernel(
  ResampleFilter.BICUBIC_MITCHELL,
  2.0,
  createCubicKernel(1.0 / 3.0, 1.0 / 3.0)
);

/**
 * Windowed sinc (Lanczos) filter with radius 3.
 */
export const Lanczos3Filter = new FilterKernel(ResampleFilter.LANCZOS3, 3.0, (x) => {
  const ax = Math.abs(x);
  if (ax === 0.0) return 1.0;
  if (ax >= 3.0) return 0.0;

  const pix = Math.PI * ax;
  const pix3 = pix / 3.0;
  return (Math.sin(pix) / pix) * (Math.sin(pix3) / pix3);
});

/**
 * Resolves a filter kernel by name or instance.
 * @param {string|FilterKernel} filter 
 * @returns {FilterKernel}
 */
export function resolveFilter(filter) {
  if (filter instanceof FilterKernel) return filter;
  switch (filter) {
    case ResampleFilter.BOX: return BoxFilter;
    case ResampleFilter.BILINEAR: return BilinearFilter;
    case ResampleFilter.BICUBIC_MITCHELL: return BicubicMitchellFilter;
    case ResampleFilter.LANCZOS3: return Lanczos3Filter;
    case ResampleFilter.BICUBIC_CATMULL_ROM:
    default:
      return BicubicCatmullRomFilter;
  }
}
