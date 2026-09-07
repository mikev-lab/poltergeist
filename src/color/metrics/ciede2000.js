/**
 * @fileoverview Complete implementation of the CIEDE2000 (Delta E 00) color difference formula.
 * Conforms to CIE Publication 142-2001 and Gaurav Sharma et al. (2005) reference specification.
 */

import { LabColor } from '../../types/color.js';

const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;

/**
 * Normalizes an angle in degrees into the half-open interval [0, 360).
 * @param {number} deg
 * @returns {number}
 */
function normalizeHueDeg(deg) {
  let val = deg % 360.0;
  if (val < 0) val += 360.0;
  return val;
}

/**
 * Computes the CIEDE2000 color difference between two CIELAB colors.
 *
 * @param {LabColor} lab1 Standard / reference color
 * @param {LabColor} lab2 Sample / reproduction color
 * @param {number} [kL=1.0] Lightness parametric weighting factor
 * @param {number} [kC=1.0] Chroma parametric weighting factor
 * @param {number} [kH=1.0] Hue parametric weighting factor
 * @returns {number} The CIEDE2000 color difference ΔE₀₀
 */
export function ciede2000(lab1, lab2, kL = 1.0, kC = 1.0, kH = 1.0) {
  const { l: L1, a: a1, b: b1 } = lab1;
  const { l: L2, a: a2, b: b2 } = lab2;

  // Step 1: Calculate C1, C2, and average chroma C_bar
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const C_bar = (C1 + C2) / 2.0;

  // G factor for chroma adjustment
  const C_bar7 = Math.pow(C_bar, 7);
  const G = 0.5 * (1.0 - Math.sqrt(C_bar7 / (C_bar7 + 6103515625))); // 25^7 = 6103515625

  // Adjusted a', C', h'
  const a1_prime = (1.0 + G) * a1;
  const a2_prime = (1.0 + G) * a2;

  const C1_prime = Math.hypot(a1_prime, b1);
  const C2_prime = Math.hypot(a2_prime, b2);

  const h1_prime = C1_prime === 0 ? 0 : normalizeHueDeg(Math.atan2(b1, a1_prime) * RAD2DEG);
  const h2_prime = C2_prime === 0 ? 0 : normalizeHueDeg(Math.atan2(b2, a2_prime) * RAD2DEG);

  // Step 2: Calculate differences ΔL', ΔC', ΔH'
  const deltaL_prime = L2 - L1;
  const deltaC_prime = C2_prime - C1_prime;

  let deltah_prime = 0;
  if (C1_prime * C2_prime !== 0) {
    const diff = h2_prime - h1_prime;
    if (Math.abs(diff) <= 180.0) {
      deltah_prime = diff;
    } else if (diff > 180.0) {
      deltah_prime = diff - 360.0;
    } else {
      deltah_prime = diff + 360.0;
    }
  }

  const deltaH_prime =
    2.0 * Math.sqrt(C1_prime * C2_prime) * Math.sin((deltah_prime / 2.0) * DEG2RAD);

  // Step 3: Calculate average values L_bar', C_bar', h_bar'
  const L_bar_prime = (L1 + L2) / 2.0;
  const C_bar_prime = (C1_prime + C2_prime) / 2.0;

  let h_bar_prime = 0;
  if (C1_prime * C2_prime === 0) {
    h_bar_prime = h1_prime + h2_prime;
  } else {
    const diff = Math.abs(h1_prime - h2_prime);
    const sum = h1_prime + h2_prime;
    if (diff <= 180.0) {
      h_bar_prime = sum / 2.0;
    } else if (sum < 360.0) {
      h_bar_prime = (sum + 360.0) / 2.0;
    } else {
      h_bar_prime = (sum - 360.0) / 2.0;
    }
  }

  // Step 4: Calculate weighting functions T, SL, SC, SH, RT
  const T =
    1.0 -
    0.17 * Math.cos((h_bar_prime - 30.0) * DEG2RAD) +
    0.24 * Math.cos(2.0 * h_bar_prime * DEG2RAD) +
    0.32 * Math.cos((3.0 * h_bar_prime + 6.0) * DEG2RAD) -
    0.20 * Math.cos((4.0 * h_bar_prime - 63.0) * DEG2RAD);

  const deltaTheta = 30.0 * Math.exp(-Math.pow((h_bar_prime - 275.0) / 25.0, 2));

  const C_bar_prime7 = Math.pow(C_bar_prime, 7);
  const RC = 2.0 * Math.sqrt(C_bar_prime7 / (C_bar_prime7 + 6103515625));

  const L_bar_minus_50_sq = Math.pow(L_bar_prime - 50.0, 2);
  const SL = 1.0 + (0.015 * L_bar_minus_50_sq) / Math.sqrt(20.0 + L_bar_minus_50_sq);
  const SC = 1.0 + 0.045 * C_bar_prime;
  const SH = 1.0 + 0.015 * C_bar_prime * T;

  const RT = -Math.sin(2.0 * deltaTheta * DEG2RAD) * RC;

  // Step 5: Final Delta E 00 calculation
  const vL = deltaL_prime / (kL * SL);
  const vC = deltaC_prime / (kC * SC);
  const vH = deltaH_prime / (kH * SH);

  const deltaE00_sq = vL * vL + vC * vC + vH * vH + RT * vC * vH;

  return Math.sqrt(Math.max(0.0, deltaE00_sq));
}
