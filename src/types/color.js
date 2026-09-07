/**
 * @fileoverview Core color models, coordinate spaces, and rendering intent primitives.
 * Strict zero-dependency mathematical color representations conforming to ICC.1:2010.
 */

/**
 * Standard ICC rendering intents.
 * @readonly
 * @enum {number}
 */
export const RenderingIntent = Object.freeze({
  PERCEPTUAL: 0,
  RELATIVE_COLORIMETRIC: 1,
  SATURATION: 2,
  ABSOLUTE_COLORIMETRIC: 3,
});

/**
 * Standard CIE D50 reference white point illuminant coordinates (ICC Profile Connection Space).
 * @readonly
 */
export const D50 = Object.freeze({
  X: 0.9642,
  Y: 1.0000,
  Z: 0.8249,
});

/**
 * Clamps a numerical value to a closed interval [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Immutable RGB color representation normalized in [0.0, 1.0].
 */
export class RgbColor {
  /**
   * @param {number} r Red component [0.0, 1.0]
   * @param {number} g Green component [0.0, 1.0]
   * @param {number} b Blue component [0.0, 1.0]
   * @param {number} [a=1.0] Alpha channel [0.0, 1.0]
   */
  constructor(r, g, b, a = 1.0) {
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) {
      throw new TypeError(`RgbColor coordinates must be finite numbers: received (${r}, ${g}, ${b}, ${a})`);
    }
    this.r = clamp(r, 0.0, 1.0);
    this.g = clamp(g, 0.0, 1.0);
    this.b = clamp(b, 0.0, 1.0);
    this.a = clamp(a, 0.0, 1.0);
    Object.freeze(this);
  }

  /**
   * Creates an RgbColor from 8-bit integers [0, 255].
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @param {number} [a=255]
   * @returns {RgbColor}
   */
  static fromBytes(r, g, b, a = 255) {
    return new RgbColor(r / 255.0, g / 255.0, b / 255.0, a / 255.0);
  }

  /**
   * Converts components to 8-bit integer array [r, g, b, a].
   * @returns {Uint8Array}
   */
  toBytes() {
    return new Uint8Array([
      Math.round(this.r * 255),
      Math.round(this.g * 255),
      Math.round(this.b * 255),
      Math.round(this.a * 255),
    ]);
  }
}

/**
 * Immutable CMYK color representation normalized in [0.0, 1.0].
 */
export class CmykColor {
  /**
   * @param {number} c Cyan component [0.0, 1.0]
   * @param {number} m Magenta component [0.0, 1.0]
   * @param {number} y Yellow component [0.0, 1.0]
   * @param {number} k Black (Key) component [0.0, 1.0]
   */
  constructor(c, m, y, k) {
    if (!Number.isFinite(c) || !Number.isFinite(m) || !Number.isFinite(y) || !Number.isFinite(k)) {
      throw new TypeError(`CmykColor coordinates must be finite numbers: received (${c}, ${m}, ${y}, ${k})`);
    }
    this.c = clamp(c, 0.0, 1.0);
    this.m = clamp(m, 0.0, 1.0);
    this.y = clamp(y, 0.0, 1.0);
    this.k = clamp(k, 0.0, 1.0);
    Object.freeze(this);
  }

  /**
   * Returns the Total Area Coverage (TAC) as an ink percentage sum (e.g., 300% = 300.0).
   * @returns {number}
   */
  get tac() {
    return (this.c + this.m + this.y + this.k) * 100.0;
  }

  /**
   * Creates a CmykColor from percentage values [0, 100].
   * @param {number} c
   * @param {number} m
   * @param {number} y
   * @param {number} k
   * @returns {CmykColor}
   */
  static fromPercentages(c, m, y, k) {
    return new CmykColor(c / 100.0, m / 100.0, y / 100.0, k / 100.0);
  }

  /**
   * Converts components to 8-bit integer array [c, m, y, k].
   * @returns {Uint8Array}
   */
  toBytes() {
    return new Uint8Array([
      Math.round(this.c * 255),
      Math.round(this.m * 255),
      Math.round(this.y * 255),
      Math.round(this.k * 255),
    ]);
  }
}

/**
 * Immutable CIEXYZ color representation (D50 reference PCS).
 */
export class XyzColor {
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  constructor(x, y, z) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new TypeError(`XyzColor coordinates must be finite numbers: received (${x}, ${y}, ${z})`);
    }
    this.x = Math.max(0.0, x);
    this.y = Math.max(0.0, y);
    this.z = Math.max(0.0, z);
    Object.freeze(this);
  }
}

/**
 * Immutable CIELAB color representation ($L^* \in [0, 100], a^* \in [-128, 127], b^* \in [-128, 127]$).
 */
export class LabColor {
  /**
   * @param {number} l Lightness [0.0, 100.0]
   * @param {number} a Green-Red chromatic axis [-128.0, 127.0]
   * @param {number} b Blue-Yellow chromatic axis [-128.0, 127.0]
   */
  constructor(l, a, b) {
    if (!Number.isFinite(l) || !Number.isFinite(a) || !Number.isFinite(b)) {
      throw new TypeError(`LabColor coordinates must be finite numbers: received (${l}, ${a}, ${b})`);
    }
    this.l = clamp(l, 0.0, 100.0);
    this.a = clamp(a, -128.0, 127.0);
    this.b = clamp(b, -128.0, 127.0);
    Object.freeze(this);
  }

  /**
   * Computes Chroma $C^*_{ab} = \sqrt{a^{*2} + b^{*2}}$.
   * @returns {number}
   */
  get chroma() {
    return Math.hypot(this.a, this.b);
  }

  /**
   * Computes Hue Angle $h_{ab}$ in degrees $[0^\circ, 360^\circ)$.
   * @returns {number}
   */
  get hue() {
    const deg = (Math.atan2(this.b, this.a) * 180.0) / Math.PI;
    return deg >= 0 ? deg : deg + 360.0;
  }
}

/**
 * Represents a named spot color ink channel.
 */
export class SpotColor {
  /**
   * @param {string} name e.g. "PANTONE 185 C", "White", "Spot UV"
   * @param {number} tint Tint intensity [0.0, 1.0]
   * @param {CmykColor} [alternateCmyk] Process CMYK fallback at 100% tint
   */
  constructor(name, tint, alternateCmyk = new CmykColor(0, 0, 0, 1)) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new TypeError(`SpotColor name must be a non-empty string: received ${name}`);
    }
    if (!Number.isFinite(tint)) {
      throw new TypeError(`SpotColor tint must be a finite number: received ${tint}`);
    }
    this.name = name.trim();
    this.tint = clamp(tint, 0.0, 1.0);
    this.alternateCmyk = alternateCmyk;
    Object.freeze(this);
  }
}
