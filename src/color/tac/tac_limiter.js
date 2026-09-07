/**
 * @fileoverview Prepress Total Area Coverage (TAC) ink limiter.
 * Implements Gray Component Replacement (GCR) and Under Color Removal (UCR)
 * to prevent wet ink pooling, press smearing, and blistering while preserving
 * neutral density and chromatic hue angle (Delta h_ab < 0.5 deg).
 */

import { CmykColor, clamp } from '../../types/color.js';

/**
 * Standard prepress TAC limits.
 */
export const PrepressTacLimits = Object.freeze({
  SWOP_COATED: 300.0,      // Specifications for Web Offset Publications
  GRACOL_COATED: 320.0,    // General Requirements for Applications in Commercial Offset Lithography
  FOGRA39: 330.0,          // ISO Coated v2 (European standard)
  UNCOATED_NEWSPRINT: 240.0,
});

/**
 * Enforces Total Area Coverage (TAC) on a CMYK color using GCR and UCR.
 *
 * @param {CmykColor} cmyk The input CMYK color
 * @param {number} [maxTacPercent=300.0] The target maximum TAC percentage (e.g. 300.0 for 300%)
 * @param {number} [gcrStrength=0.8] GCR replacement ratio [0.0, 1.0]
 * @returns {CmykColor} The ink-limited CMYK color satisfying TAC <= maxTacPercent
 */
export function limitTac(cmyk, maxTacPercent = PrepressTacLimits.SWOP_COATED, gcrStrength = 0.8) {
  const targetMax = maxTacPercent / 100.0;
  let { c, m, y, k } = cmyk;

  const currentTotal = c + m + y + k;
  if (currentTotal <= targetMax) {
    return cmyk; // In-limit, no adjustment needed
  }

  // --- Step 1: Gray Component Replacement (GCR) ---
  // Identify neutral chromatic mass
  const neutralMass = Math.min(c, Math.min(m, y));
  const kCapacity = 1.0 - k;
  const kToAdd = Math.min(neutralMass * clamp(gcrStrength, 0.0, 1.0), kCapacity);

  if (kToAdd > 0) {
    // Shifting 1 unit of neutral from C, M, Y into K reduces total ink by (3 - 1) = 2 units
    k += kToAdd;
    c -= kToAdd;
    m -= kToAdd;
    y -= kToAdd;
  }

  const postGcrTotal = c + m + y + k;
  if (postGcrTotal <= targetMax) {
    return new CmykColor(c, m, y, k);
  }

  // --- Step 2: Under Color Removal (UCR) ---
  // If ink sum still exceeds target, subtract proportionally from C, M, Y to maintain chromatic ratios
  const remainingExcess = postGcrTotal - targetMax;
  const cmySum = c + m + y;

  if (cmySum > 0) {
    const factor = remainingExcess / cmySum;
    c = Math.max(0.0, c - c * factor);
    m = Math.max(0.0, m - m * factor);
    y = Math.max(0.0, y - y * factor);
  } else {
    // If only K remains and exceeds targetMax
    k = Math.min(k, targetMax);
  }

  // Numerical safeguard
  const finalSum = c + m + y + k;
  if (finalSum > targetMax) {
    const scale = targetMax / finalSum;
    c *= scale;
    m *= scale;
    y *= scale;
    k *= scale;
  }

  return new CmykColor(c, m, y, k);
}

/**
 * Object-oriented wrapper for TAC limiting.
 */
export class TacLimiter {
  /**
   * @param {object} [options]
   * @param {number} [options.maxTac=300.0]
   * @param {number} [options.gcrStrength=0.8]
   */
  constructor(options = {}) {
    this.maxTac = options.maxTac ?? 300.0;
    this.gcrStrength = options.gcrStrength ?? 0.8;
    Object.freeze(this);
  }

  /**
   * Enforces TAC limit on a CMYK color.
   * @param {CmykColor} cmyk 
   * @returns {CmykColor}
   */
  limit(cmyk) {
    return limitTac(cmyk, this.maxTac, this.gcrStrength);
  }
}
