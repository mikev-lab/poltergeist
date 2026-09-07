/**
 * @fileoverview Tone Reproduction Curve (TRC) evaluators.
 * Supports curveType ('curv') and parametricCurveType ('para') types 0-4.
 */

import { clamp } from '../../types/color.js';
import { readAscii4, readS15Fixed16 } from './header.js';

/**
 * Base Tone Reproduction Curve evaluator.
 */
export class ToneReproductionCurve {
  /**
   * Evaluates the curve for a normalized input x in [0.0, 1.0].
   * @param {number} x
   * @returns {number}
   */
  evaluate(x) {
    throw new Error('evaluate() must be implemented by subclass');
  }

  /**
   * Evaluates the inverse curve for a normalized output y in [0.0, 1.0].
   * @param {number} y
   * @returns {number}
   */
  evaluateInverse(y) {
    throw new Error('evaluateInverse() must be implemented by subclass');
  }

  /**
   * Parses a TRC tag from a buffer.
   * @param {Uint8Array} buffer
   * @param {number} offset
   * @returns {ToneReproductionCurve}
   */
  static fromBuffer(buffer, offset = 0) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset);
    const sig = readAscii4(view, 0);

    if (sig === 'curv') {
      const count = view.getUint32(8, false);
      if (count === 0) {
        return new LinearCurve();
      } else if (count === 1) {
        // Gamma encoded as u8.8 fixed-point
        const gamma = view.getUint16(12, false) / 256.0;
        return new GammaCurve(gamma);
      } else {
        const table = new Float64Array(count);
        for (let i = 0; i < count; i++) {
          table[i] = view.getUint16(12 + i * 2, false) / 65535.0;
        }
        return new SampledCurve(table);
      }
    } else if (sig === 'para') {
      const funcType = view.getUint16(8, false);
      // Parameters encoded as s15Fixed16
      const params = [];
      const paramCount = [1, 3, 4, 5, 7][funcType];
      if (paramCount === undefined) {
        throw new Error(`Unsupported parametric curve function type: ${funcType}`);
      }
      for (let p = 0; p < paramCount; p++) {
        params.push(readS15Fixed16(view, 12 + p * 4));
      }
      return new ParametricCurve(funcType, params);
    } else {
      throw new Error(`Unknown TRC tag signature: '${sig}'`);
    }
  }
}

/**
 * Linear identity curve f(x) = x.
 */
export class LinearCurve extends ToneReproductionCurve {
  evaluate(x) {
    return clamp(x, 0.0, 1.0);
  }

  evaluateInverse(y) {
    return clamp(y, 0.0, 1.0);
  }
}

/**
 * Exponential gamma curve f(x) = x^gamma.
 */
export class GammaCurve extends ToneReproductionCurve {
  /**
   * @param {number} gamma
   */
  constructor(gamma) {
    super();
    this.gamma = gamma;
    this.invGamma = gamma > 0 ? 1.0 / gamma : 1.0;
  }

  evaluate(x) {
    const clamped = clamp(x, 0.0, 1.0);
    return Math.pow(clamped, this.gamma);
  }

  evaluateInverse(y) {
    const clamped = clamp(y, 0.0, 1.0);
    return Math.pow(clamped, this.invGamma);
  }
}

/**
 * 1D Sampled lookup table with linear interpolation.
 */
export class SampledCurve extends ToneReproductionCurve {
  /**
   * @param {Float64Array|number[]} table
   */
  constructor(table) {
    super();
    this.table = table instanceof Float64Array ? table : new Float64Array(table);
    this.count = this.table.length;
  }

  evaluate(x) {
    const clamped = clamp(x, 0.0, 1.0);
    const scaled = clamped * (this.count - 1);
    const i0 = Math.min(Math.floor(scaled), this.count - 2);
    const frac = scaled - i0;
    return this.table[i0] + frac * (this.table[i0 + 1] - this.table[i0]);
  }

  evaluateInverse(y) {
    const target = clamp(y, 0.0, 1.0);
    // Binary search in monotonic table
    let low = 0;
    let high = this.count - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.table[mid] < target) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const i0 = Math.max(0, Math.min(low - 1, this.count - 2));
    const v0 = this.table[i0];
    const v1 = this.table[i0 + 1];
    const span = v1 - v0;
    const frac = span > 1e-12 ? (target - v0) / span : 0.0;
    return clamp((i0 + frac) / (this.count - 1), 0.0, 1.0);
  }
}

/**
 * Parametric curve functions 0-4 per ICC.1:2010.
 */
export class ParametricCurve extends ToneReproductionCurve {
  /**
   * @param {number} funcType
   * @param {number[]} params
   */
  constructor(funcType, params) {
    super();
    this.funcType = funcType;
    this.params = params;
  }

  evaluate(x) {
    const X = clamp(x, 0.0, 1.0);
    const p = this.params;

    switch (this.funcType) {
      case 0: {
        // Y = X^g
        return Math.pow(X, p[0]);
      }
      case 1: {
        // Y = (a*X + b)^g  [X >= -b/a], else 0
        const lin = p[1] * X + p[2];
        return lin >= 0 ? Math.pow(lin, p[0]) : 0.0;
      }
      case 2: {
        // Y = (a*X + b)^g + c  [X >= -b/a], else c
        const lin = p[1] * X + p[2];
        return lin >= 0 ? Math.pow(lin, p[0]) + p[3] : p[3];
      }
      case 3: {
        // Y = (a*X + b)^g  [X >= d], else c*X (sRGB form)
        if (X >= p[4]) {
          return Math.pow(p[1] * X + p[2], p[0]);
        }
        return p[3] * X;
      }
      case 4: {
        // Y = (a*X + b)^g + e  [X >= d], else c*X + f
        if (X >= p[4]) {
          return Math.pow(p[1] * X + p[2], p[0]) + p[5];
        }
        return p[3] * X + p[6];
      }
      default:
        throw new Error(`Invalid parametric function type ${this.funcType}`);
    }
  }

  evaluateInverse(y) {
    const Y = clamp(y, 0.0, 1.0);
    const p = this.params;

    switch (this.funcType) {
      case 0:
        return Math.pow(Y, 1.0 / p[0]);
      case 1: {
        const val = Math.pow(Y, 1.0 / p[0]);
        return clamp((val - p[2]) / p[1], 0.0, 1.0);
      }
      case 2: {
        const val = Math.pow(Math.max(0.0, Y - p[3]), 1.0 / p[0]);
        return clamp((val - p[2]) / p[1], 0.0, 1.0);
      }
      case 3: {
        // Threshold Y_d = p[3] * p[4] or (a*d + b)^g
        const Y_d = p[3] * p[4];
        if (Y >= Y_d) {
          return clamp((Math.pow(Y, 1.0 / p[0]) - p[2]) / p[1], 0.0, 1.0);
        }
        return p[3] > 0 ? clamp(Y / p[3], 0.0, 1.0) : 0.0;
      }
      case 4: {
        const Y_d = p[3] * p[4] + p[6];
        if (Y >= Y_d) {
          return clamp((Math.pow(Math.max(0.0, Y - p[5]), 1.0 / p[0]) - p[2]) / p[1], 0.0, 1.0);
        }
        return p[3] > 0 ? clamp((Y - p[6]) / p[3], 0.0, 1.0) : 0.0;
      }
      default:
        throw new Error(`Invalid parametric function type ${this.funcType}`);
    }
  }
}
