/**
 * @fileoverview Spot Color (Separation & DeviceN) color space representations and TintTransform evaluators.
 */

import { CmykColor, RgbColor, clamp } from '../../types/color.js';

/**
 * Standard single-ink Separation Color Space (e.g. PANTONE, Spot Varnish, Die Cut).
 */
export class SeparationColorSpace {
  /**
   * @param {string} name Spot ink identifier
   * @param {string} alternateSpace Target alternate color space ('DeviceCMYK' | 'DeviceRGB')
   * @param {(tint: number) => CmykColor|RgbColor} tintTransform Function mapping tint in [0.0, 1.0] to alternate space
   */
  constructor(name, alternateSpace, tintTransform) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new TypeError(`SeparationColorSpace name must be non-empty string, received: ${name}`);
    }
    this.name = name.trim();
    this.alternateSpace = alternateSpace;
    this.tintTransform = tintTransform;
    Object.freeze(this);
  }

  /**
   * Evaluates the tint transform for a normalized tint value [0.0, 1.0].
   * @param {number} tint
   * @returns {CmykColor|RgbColor}
   */
  evaluate(tint) {
    const t = clamp(tint, 0.0, 1.0);
    return this.tintTransform(t);
  }

  /**
   * Helper to create a linear CMYK-tinted spot color.
   * @param {string} name
   * @param {CmykColor} fullTintCmyk 100% ink representation in CMYK
   * @returns {SeparationColorSpace}
   */
  static createCmykSpot(name, fullTintCmyk) {
    return new SeparationColorSpace(name, 'DeviceCMYK', (tint) => {
      return new CmykColor(
        fullTintCmyk.c * tint,
        fullTintCmyk.m * tint,
        fullTintCmyk.y * tint,
        fullTintCmyk.k * tint
      );
    });
  }
}

/**
 * Multi-channel DeviceN Color Space.
 */
export class DeviceNColorSpace {
  /**
   * @param {string[]} names Array of spot/process ink channel names
   * @param {string} alternateSpace Target alternate color space
   * @param {(tints: number[]) => CmykColor|RgbColor} tintTransform
   */
  constructor(names, alternateSpace, tintTransform) {
    if (!Array.isArray(names) || names.length === 0) {
      throw new TypeError('DeviceNColorSpace requires a non-empty array of channel names');
    }
    this.names = Object.freeze([...names]);
    this.alternateSpace = alternateSpace;
    this.tintTransform = tintTransform;
    Object.freeze(this);
  }

  /**
   * Evaluates the multi-channel TintTransform.
   * @param {number[]} tints Array of normalized tint values [0.0, 1.0]
   * @returns {CmykColor|RgbColor}
   */
  evaluate(tints) {
    const clamped = tints.map((t) => clamp(t, 0.0, 1.0));
    return this.tintTransform(clamped);
  }
}

/**
 * Standard Prepress Spot Color Registry.
 */
export const StandardSpotColors = Object.freeze({
  PANTONE_185_C: SeparationColorSpace.createCmykSpot(
    'PANTONE 185 C',
    new CmykColor(0.0, 0.93, 0.79, 0.0) // Vivid Warm Red
  ),
  PANTONE_REFLEX_BLUE_C: SeparationColorSpace.createCmykSpot(
    'PANTONE Reflex Blue C',
    new CmykColor(1.0, 0.89, 0.0, 0.0) // Deep Blue
  ),
  SPOT_WHITE: SeparationColorSpace.createCmykSpot(
    'Spot White',
    new CmykColor(0.0, 0.0, 0.0, 0.0) // Opaque Underprint
  ),
  SPOT_VARNISH: SeparationColorSpace.createCmykSpot(
    'Varnish',
    new CmykColor(0.0, 0.0, 0.0, 0.0) // Clear Coat
  ),
  CUT_CONTOUR: SeparationColorSpace.createCmykSpot(
    'CutContour',
    new CmykColor(0.0, 1.0, 0.0, 0.0) // 100% Magenta Die Line
  ),
});
