/**
 * @file cfa.js
 * @description Color Filter Array (CFA) definitions, Bayer pattern geometries, and sensor calibration models.
 * Strictly zero-dependency and memory-safe.
 */

export const CfaPattern = Object.freeze({
  RGGB: 0,
  BGGR: 1,
  GRBG: 2,
  GBRG: 3
});

export const ColorChannel = Object.freeze({
  RED: 0,
  GREEN: 1,
  BLUE: 2
});

export class RawMetadata {
  /**
   * @param {object} [options]
   * @param {number} [options.width=0]
   * @param {number} [options.height=0]
   * @param {number} [options.cfaPattern=CfaPattern.RGGB]
   * @param {number|number[]} [options.blackLevel=0]
   * @param {number} [options.whiteLevel=65535]
   * @param {number[]} [options.colorMatrix1] 3x3 array of numbers mapping sensor RGB to CIEXYZ
   * @param {number[]} [options.whiteBalance] [rScale, gScale, bScale]
   * @param {number} [options.iso=100]
   * @param {string} [options.make='']
   * @param {string} [options.model='']
   */
  constructor({
    width = 0,
    height = 0,
    cfaPattern = CfaPattern.RGGB,
    blackLevel = 0,
    whiteLevel = 65535,
    colorMatrix1 = null,
    whiteBalance = [1.0, 1.0, 1.0],
    iso = 100,
    make = '',
    model = ''
  } = {}) {
    this.width = width;
    this.height = height;
    this.cfaPattern = cfaPattern;
    this.blackLevel = Array.isArray(blackLevel) ? [...blackLevel] : [blackLevel, blackLevel, blackLevel, blackLevel];
    this.whiteLevel = whiteLevel > 0 ? whiteLevel : 65535;
    // Standard D65 Camera to XYZ Matrix if none provided
    this.colorMatrix1 = colorMatrix1 ? [...colorMatrix1] : [
      0.4124564, 0.3575761, 0.1804375,
      0.2126729, 0.7151522, 0.0721750,
      0.0193339, 0.1191920, 0.9503041
    ];
    this.whiteBalance = [...whiteBalance];
    this.iso = iso;
    this.make = make;
    this.model = model;
    Object.freeze(this);
  }

  /**
   * Returns which color channel (RED=0, GREEN=1, BLUE=2) exists at (row, col).
   * @param {number} row
   * @param {number} col
   * @returns {number} ColorChannel
   */
  getChannelAt(row, col) {
    const r = row & 1;
    const c = col & 1;

    switch (this.cfaPattern) {
      case CfaPattern.RGGB:
        if (r === 0 && c === 0) return ColorChannel.RED;
        if (r === 0 && c === 1) return ColorChannel.GREEN;
        if (r === 1 && c === 0) return ColorChannel.GREEN;
        return ColorChannel.BLUE;

      case CfaPattern.BGGR:
        if (r === 0 && c === 0) return ColorChannel.BLUE;
        if (r === 0 && c === 1) return ColorChannel.GREEN;
        if (r === 1 && c === 0) return ColorChannel.GREEN;
        return ColorChannel.RED;

      case CfaPattern.GRBG:
        if (r === 0 && c === 0) return ColorChannel.GREEN;
        if (r === 0 && c === 1) return ColorChannel.RED;
        if (r === 1 && c === 0) return ColorChannel.BLUE;
        return ColorChannel.GREEN;

      case CfaPattern.GBRG:
        if (r === 0 && c === 0) return ColorChannel.GREEN;
        if (r === 0 && c === 1) return ColorChannel.BLUE;
        if (r === 1 && c === 0) return ColorChannel.RED;
        return ColorChannel.GREEN;

      default:
        return ColorChannel.GREEN;
    }
  }
}
