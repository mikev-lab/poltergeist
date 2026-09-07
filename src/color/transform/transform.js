/**
 * @fileoverview End-to-end Color Management Transformation Pipeline.
 * Coordinates Source -> PCS (XYZ/Lab) -> Destination Profile transformations,
 * supporting Matrix/TRC and multidimensional LUT profiles with tetrahedral interpolation.
 */

import {
  RgbColor,
  CmykColor,
  XyzColor,
  LabColor,
  RenderingIntent,
  D50,
  clamp,
} from '../../types/color.js';
import { IccProfile } from '../icc/profile.js';
import { xyzToLab, labToXyz } from './pcs.js';

/**
 * Multiplies a 3x3 column-vector matrix with a 3-element vector.
 * @param {XyzColor} col1
 * @param {XyzColor} col2
 * @param {XyzColor} col3
 * @param {number[]} v [r, g, b]
 * @returns {XyzColor}
 */
function matrixMultiply(col1, col2, col3, v) {
  const x = col1.x * v[0] + col2.x * v[1] + col3.x * v[2];
  const y = col1.y * v[0] + col2.y * v[1] + col3.y * v[2];
  const z = col1.z * v[0] + col2.z * v[1] + col3.z * v[2];
  return new XyzColor(x, y, z);
}

/**
 * Inverts a 3x3 matrix defined by three column vectors.
 * @param {XyzColor} col1
 * @param {XyzColor} col2
 * @param {XyzColor} col3
 * @returns {number[][]}
 */
function invert3x3(col1, col2, col3) {
  const a = col1.x, b = col2.x, c = col3.x;
  const d = col1.y, e = col2.y, f = col3.y;
  const g = col1.z, h = col2.z, i = col3.z;

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) {
    throw new Error('Matrix inversion failed: determinant is zero');
  }

  const invDet = 1.0 / det;

  return [
    [A * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
    [B * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
    [C * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet],
  ];
}

/**
 * End-to-end ColorTransform engine.
 */
export class ColorTransform {
  /**
   * @param {IccProfile} sourceProfile
   * @param {IccProfile} destProfile
   * @param {number} [renderingIntent=RenderingIntent.RELATIVE_COLORIMETRIC]
   */
  constructor(sourceProfile, destProfile, renderingIntent = RenderingIntent.RELATIVE_COLORIMETRIC) {
    this.sourceProfile = sourceProfile;
    this.destProfile = destProfile;
    this.renderingIntent = renderingIntent;

    // Cache matrix inverse if source or destination is matrix/shaper
    if (this.sourceProfile.isMatrixShaper()) {
      this.srcR = this.sourceProfile.getTag('rXYZ');
      this.srcG = this.sourceProfile.getTag('gXYZ');
      this.srcB = this.sourceProfile.getTag('bXYZ');
      this.srcRtrc = this.sourceProfile.getTag('rTRC');
      this.srcGtrc = this.sourceProfile.getTag('gTRC');
      this.srcBtrc = this.sourceProfile.getTag('bTRC');
    }

    if (this.destProfile.isLutBased()) {
      this.dstLut = this.destProfile.getTag('B2A0') || this.destProfile.getTag('B2A1');
    } else if (this.destProfile.isMatrixShaper()) {
      const dstR = this.destProfile.getTag('rXYZ');
      const dstG = this.destProfile.getTag('gXYZ');
      const dstB = this.destProfile.getTag('bXYZ');
      this.dstInvMatrix = invert3x3(dstR, dstG, dstB);
      this.dstRtrc = this.destProfile.getTag('rTRC');
      this.dstGtrc = this.destProfile.getTag('gTRC');
      this.dstBtrc = this.destProfile.getTag('bTRC');
    }
  }

  /**
   * Transforms an input RGB color into destination CMYK space.
   *
   * @param {RgbColor} rgb
   * @returns {CmykColor}
   */
  transformRgbToCmyk(rgb) {
    // 1. Source -> PCS (XYZ)
    let pcsXyz;
    let pcsLab;

    if (this.sourceProfile.isMatrixShaper()) {
      const rLin = this.srcRtrc.evaluate(rgb.r);
      const gLin = this.srcGtrc.evaluate(rgb.g);
      const bLin = this.srcBtrc.evaluate(rgb.b);

      pcsXyz = matrixMultiply(this.srcR, this.srcG, this.srcB, [rLin, gLin, bLin]);
      pcsLab = xyzToLab(pcsXyz, D50);
    } else if (this.sourceProfile.isLutBased()) {
      const srcLut = this.sourceProfile.getTag('A2B0');
      const out = srcLut.evaluate([rgb.r, rgb.g, rgb.b]);
      if (this.sourceProfile.pcs === 'Lab ') {
        pcsLab = new LabColor(out[0] * 100.0, out[1] * 255.0 - 128.0, out[2] * 255.0 - 128.0);
        pcsXyz = labToXyz(pcsLab, D50);
      } else {
        pcsXyz = new XyzColor(out[0], out[1], out[2]);
        pcsLab = xyzToLab(pcsXyz, D50);
      }
    } else {
      throw new Error(`Unsupported source profile format: ${this.sourceProfile.colorSpace}`);
    }

    // 2. PCS -> Destination (CMYK)
    if (this.dstLut) {
      // Normalize Lab inputs into [0.0, 1.0]
      const normL = clamp(pcsLab.l / 100.0, 0.0, 1.0);
      const normA = clamp((pcsLab.a + 128.0) / 255.0, 0.0, 1.0);
      const normB = clamp((pcsLab.b + 128.0) / 255.0, 0.0, 1.0);

      const cmykRaw = this.dstLut.evaluate([normL, normA, normB]);
      return new CmykColor(cmykRaw[0], cmykRaw[1], cmykRaw[2], cmykRaw[3]);
    } else {
      // Analytical standard CMYK fallback if destination is not LUT-based
      const c = 1.0 - rgb.r;
      const m = 1.0 - rgb.g;
      const y = 1.0 - rgb.b;
      const k = Math.min(c, Math.min(m, y));
      if (k >= 1.0) return new CmykColor(0, 0, 0, 1.0);
      return new CmykColor((c - k) / (1.0 - k), (m - k) / (1.0 - k), (y - k) / (1.0 - k), k);
    }
  }

  /**
   * Transforms an input CMYK color into reference PCS CIELAB.
   * @param {CmykColor} cmyk
   * @returns {LabColor}
   */
  transformCmykToLab(cmyk) {
    const lut = this.destProfile.getTag('A2B0');
    if (!lut) {
      throw new Error('Destination profile does not have A2B0 tag for CMYK -> Lab transformation');
    }
    const raw = lut.evaluate([cmyk.c, cmyk.m, cmyk.y, cmyk.k]);
    return new LabColor(raw[0] * 100.0, raw[1] * 255.0 - 128.0, raw[2] * 255.0 - 128.0);
  }
}
