/**
 * @fileoverview Subtractive Overprint Simulation Engine (-dSimulateOverprint).
 * Models physical ink mixing and plate transparency for prepress soft proofing.
 */

import { CmykColor, clamp } from '../../types/color.js';

/**
 * Simulates overprinting between background and foreground CMYK ink plates.
 *
 * @param {CmykColor} bg Background plate inks
 * @param {CmykColor} fg Foreground plate inks
 * @param {Object} options
 * @param {boolean} [options.overprint=true] Whether overprint is active (/OP true)
 * @param {number} [options.overprintMode=1] Overprint Mode (0: knockout zero channels, 1: OPM 1 prepress standard)
 * @param {boolean} [options.subtractiveMixing=false] If true, computes multiplicative subtractive ink density
 * @returns {CmykColor} Resulting composite CMYK color
 */
export function simulateOverprint(
  bg,
  fg,
  { overprint = true, overprintMode = 1, subtractiveMixing = false } = {}
) {
  if (!overprint) {
    // Normal knockout: foreground completely obscures background
    return fg;
  }

  const applyChannel = (bgVal, fgVal) => {
    if (overprintMode === 1) {
      // In OPM=1, if fgVal == 0, the background plate prints through untouched
      if (fgVal === 0.0) return bgVal;

      if (subtractiveMixing) {
        // Multiplicative ink absorption: 1 - (1 - bg)(1 - fg)
        return bgVal + fgVal - bgVal * fgVal;
      }
      // Standard plate replacement for active channel
      return fgVal;
    } else {
      // OPM=0: foreground value directly replaces background
      return fgVal;
    }
  };

  const c = applyChannel(bg.c, fg.c);
  const m = applyChannel(bg.m, fg.m);
  const y = applyChannel(bg.y, fg.y);
  const k = applyChannel(bg.k, fg.k);

  return new CmykColor(c, m, y, k);
}

/**
 * Simulates overprinting a spot ink plate over a background CMYK buffer.
 *
 * @param {CmykColor} bg Background CMYK color
 * @param {CmykColor} spotCmyk Equivalent CMYK of the spot ink at current tint
 * @returns {CmykColor}
 */
export function simulateSpotOverprint(bg, spotCmyk) {
  // Spot inks are laid down as an additional plate over the process plates
  // Subtractive ink layering: 1 - out = (1 - bg) * (1 - spot)
  const c = bg.c + spotCmyk.c - bg.c * spotCmyk.c;
  const m = bg.m + spotCmyk.m - bg.m * spotCmyk.m;
  const y = bg.y + spotCmyk.y - bg.y * spotCmyk.y;
  const k = bg.k + spotCmyk.k - bg.k * spotCmyk.k;

  return new CmykColor(clamp(c, 0.0, 1.0), clamp(m, 0.0, 1.0), clamp(y, 0.0, 1.0), clamp(k, 0.0, 1.0));
}
