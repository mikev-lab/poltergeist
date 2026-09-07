/**
 * @file blend_modes.js
 * @description Prepress separable blend mode mathematical equations for Poltergeist.
 * Strictly zero-dependency, matches ISO 32000 / Adobe Photoshop blend equations.
 */

import { BlendMode } from '../../types/layer.js';

export { BlendMode, BlendMode as PrepressBlendMode };

/**
 * Evaluates the non-alpha blend formula B(Cb, Cs) for normalized color values in [0, 1].
 * @param {string} mode 
 * @param {number} b Backdrop sample [0, 1]
 * @param {number} s Source sample [0, 1]
 * @returns {number}
 */
export function blendChannel(mode, b, s) {
  switch (mode) {
    case BlendMode.MULTIPLY:
      return b * s;

    case BlendMode.SCREEN:
      return b + s - b * s;

    case BlendMode.OVERLAY:
      return b <= 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s);

    case BlendMode.HARD_LIGHT:
      return s <= 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s);

    case BlendMode.DARKEN:
      return Math.min(b, s);

    case BlendMode.LIGHTEN:
      return Math.max(b, s);

    case BlendMode.COLOR_DODGE:
      if (b === 0) return 0;
      if (s >= 1.0) return 1.0;
      return Math.min(1.0, b / (1.0 - s));

    case BlendMode.COLOR_BURN:
      if (b >= 1.0) return 1.0;
      if (s <= 0) return 0;
      return 1.0 - Math.min(1.0, (1.0 - b) / s);

    case BlendMode.SOFT_LIGHT: {
      if (s <= 0.5) {
        return b - (1.0 - 2.0 * s) * b * (1.0 - b);
      } else {
        const d = b <= 0.25
          ? ((16.0 * b - 12.0) * b + 4.0) * b
          : Math.sqrt(b);
        return b + (2.0 * s - 1.0) * (d - b);
      }
    }

    case BlendMode.DIFFERENCE:
      return Math.abs(b - s);

    case BlendMode.EXCLUSION:
      return b + s - 2.0 * b * s;

    case BlendMode.NORMAL:
    default:
      return s;
  }
}

/**
 * Blends a source pixel with a backdrop pixel considering alpha and blend mode.
 * @param {string} mode BlendMode
 * @param {number} b Backdrop color [0, 1]
 * @param {number} ab Backdrop alpha [0, 1]
 * @param {number} s Source color [0, 1]
 * @param {number} as Source alpha [0, 1]
 * @returns {{ color: number, alpha: number }}
 */
export function blendWithAlpha(mode, b, ab, s, as) {
  if (as === 0) return { color: b, alpha: ab };
  if (ab === 0) return { color: s, alpha: as };

  const ar = as + ab * (1.0 - as);
  if (ar <= 0) return { color: 0, alpha: 0 };

  const blended = blendChannel(mode, b, s);
  const cr = (1.0 - ab) * as * s + (1.0 - as) * ab * b + as * ab * blended;

  return {
    color: Math.max(0.0, Math.min(1.0, cr / ar)),
    alpha: Math.max(0.0, Math.min(1.0, ar))
  };
}
