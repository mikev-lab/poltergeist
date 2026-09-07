/**
 * @file porter_duff.js
 * @description Porter-Duff alpha compositing operators for Poltergeist.
 * Strictly zero-dependency and memory-safe.
 */

export const CompositeOperator = Object.freeze({
  SRC_OVER: 'src-over',
  DST_OVER: 'dst-over',
  SRC_IN: 'src-in',
  DST_IN: 'dst-in',
  SRC_OUT: 'src-out',
  DST_OUT: 'dst-out',
  SRC_ATOP: 'src-atop',
  DST_ATOP: 'dst-atop',
  XOR: 'xor',
  CLEAR: 'clear'
});

/**
 * Composites a source sample over a destination sample using Porter-Duff Source Over.
 * @param {number} srcColor Normalized source color [0, 1]
 * @param {number} srcAlpha Normalized source alpha [0, 1]
 * @param {number} dstColor Normalized destination color [0, 1]
 * @param {number} dstAlpha Normalized destination alpha [0, 1]
 * @returns {{ color: number, alpha: number }}
 */
export function compositeSourceOver(srcColor, srcAlpha, dstColor, dstAlpha) {
  if (srcAlpha === 0 && dstAlpha === 0) {
    return { color: 0, alpha: 0 };
  }
  if (srcAlpha === 1.0) {
    return { color: srcColor, alpha: 1.0 };
  }
  if (dstAlpha === 0) {
    return { color: srcColor, alpha: srcAlpha };
  }

  const outAlpha = srcAlpha + dstAlpha * (1.0 - srcAlpha);
  if (outAlpha <= 0) return { color: 0, alpha: 0 };

  const outColor = (srcColor * srcAlpha + dstColor * dstAlpha * (1.0 - srcAlpha)) / outAlpha;
  return {
    color: Math.max(0.0, Math.min(1.0, outColor)),
    alpha: Math.max(0.0, Math.min(1.0, outAlpha))
  };
}
