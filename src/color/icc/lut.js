/**
 * @fileoverview Multi-dimensional Look-Up Table (LUT) parser for ICC profiles.
 * Supports mft1 (lut8Type), mft2 (lut16Type), mABType, and mBAType.
 */

import { clamp } from '../../types/color.js';
import { readAscii4, readS15Fixed16 } from './header.js';
import { interpolateTetrahedral3D, interpolateSimplex4D } from '../transform/tetrahedral.js';
import { ToneReproductionCurve, SampledCurve, LinearCurve } from './trc.js';

/**
 * Base Multidimensional LUT representation.
 */
export class MultidimensionalLut {
  /**
   * Evaluates the LUT pipeline for a normalized input array.
   * @param {number[]} inputs
   * @returns {number[]}
   */
  evaluate(inputs) {
    throw new Error('evaluate() must be implemented by subclass');
  }

  /**
   * Factory method to deserialize LUT tags.
   * @param {Uint8Array} buffer
   * @param {number} offset
   * @returns {MultidimensionalLut}
   */
  static fromBuffer(buffer, offset = 0) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset);
    const sig = readAscii4(view, 0);

    if (sig === 'mft1') {
      return Lut8.fromBuffer(buffer, offset);
    } else if (sig === 'mft2') {
      return Lut16.fromBuffer(buffer, offset);
    } else if (sig === 'mAB ') {
      return LutAtoB.fromBuffer(buffer, offset);
    } else if (sig === 'mBA ') {
      return LutBtoA.fromBuffer(buffer, offset);
    } else {
      throw new Error(`Unsupported LUT signature: '${sig}'`);
    }
  }
}

/**
 * lut8Type (mft1) parser.
 */
export class Lut8 extends MultidimensionalLut {
  constructor(fields) {
    super();
    this.inChannels = fields.inChannels;
    this.outChannels = fields.outChannels;
    this.gridPoints = fields.gridPoints;
    this.matrix = fields.matrix; // 3x3 matrix
    this.inputTables = fields.inputTables; // Array of SampledCurve
    this.clut = fields.clut; // Float64Array
    this.outputTables = fields.outputTables; // Array of SampledCurve
    Object.freeze(this);
  }

  static fromBuffer(buffer, offset = 0) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset);
    const inChannels = view.getUint8(8);
    const outChannels = view.getUint8(9);
    const gridPoints = view.getUint8(10);

    // 3x3 Matrix (s15Fixed16)
    const matrix = [];
    for (let r = 0; r < 3; r++) {
      matrix[r] = [];
      for (let c = 0; c < 3; c++) {
        matrix[r][c] = readS15Fixed16(view, 12 + (r * 3 + c) * 4);
      }
    }

    let ptr = 48;

    // Input tables: inChannels x 256 entries (8-bit)
    const inputTables = [];
    for (let ch = 0; ch < inChannels; ch++) {
      const tbl = new Float64Array(256);
      for (let i = 0; i < 256; i++) {
        tbl[i] = view.getUint8(ptr++) / 255.0;
      }
      inputTables.push(new SampledCurve(tbl));
    }

    // CLUT: (gridPoints ^ inChannels) * outChannels (8-bit)
    const totalClutEntries = Math.pow(gridPoints, inChannels) * outChannels;
    const clut = new Float64Array(totalClutEntries);
    for (let i = 0; i < totalClutEntries; i++) {
      clut[i] = view.getUint8(ptr++) / 255.0;
    }

    // Output tables: outChannels x 256 entries (8-bit)
    const outputTables = [];
    for (let ch = 0; ch < outChannels; ch++) {
      const tbl = new Float64Array(256);
      for (let i = 0; i < 256; i++) {
        tbl[i] = view.getUint8(ptr++) / 255.0;
      }
      outputTables.push(new SampledCurve(tbl));
    }

    return new Lut8({
      inChannels,
      outChannels,
      gridPoints,
      matrix,
      inputTables,
      clut,
      outputTables,
    });
  }

  evaluate(inputs) {
    // 1. Pass through input 1D tables
    const stage1 = new Array(this.inChannels);
    for (let i = 0; i < this.inChannels; i++) {
      stage1[i] = this.inputTables[i].evaluate(inputs[i] || 0.0);
    }

    // 2. Interpolate in CLUT
    const stage2 = new Float64Array(this.outChannels);
    if (this.inChannels === 3) {
      interpolateTetrahedral3D(
        this.clut,
        this.gridPoints,
        this.outChannels,
        stage1[0],
        stage1[1],
        stage1[2],
        stage2
      );
    } else if (this.inChannels === 4) {
      interpolateSimplex4D(
        this.clut,
        this.gridPoints,
        this.outChannels,
        stage1[0],
        stage1[1],
        stage1[2],
        stage1[3],
        stage2
      );
    } else {
      throw new Error(`Unsupported CLUT input dimension: ${this.inChannels}`);
    }

    // 3. Pass through output 1D tables
    const results = new Array(this.outChannels);
    for (let i = 0; i < this.outChannels; i++) {
      results[i] = this.outputTables[i].evaluate(stage2[i]);
    }
    return results;
  }
}

/**
 * lut16Type (mft2) parser.
 */
export class Lut16 extends MultidimensionalLut {
  constructor(fields) {
    super();
    this.inChannels = fields.inChannels;
    this.outChannels = fields.outChannels;
    this.gridPoints = fields.gridPoints;
    this.matrix = fields.matrix;
    this.inputTables = fields.inputTables;
    this.clut = fields.clut;
    this.outputTables = fields.outputTables;
    Object.freeze(this);
  }

  static fromBuffer(buffer, offset = 0) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset);
    const inChannels = view.getUint8(8);
    const outChannels = view.getUint8(9);
    const gridPoints = view.getUint8(10);

    const matrix = [];
    for (let r = 0; r < 3; r++) {
      matrix[r] = [];
      for (let c = 0; c < 3; c++) {
        matrix[r][c] = readS15Fixed16(view, 12 + (r * 3 + c) * 4);
      }
    }

    const inTableEntries = view.getUint16(48, false);
    const outTableEntries = view.getUint16(50, false);

    let ptr = 52;

    const inputTables = [];
    for (let ch = 0; ch < inChannels; ch++) {
      const tbl = new Float64Array(inTableEntries);
      for (let i = 0; i < inTableEntries; i++) {
        tbl[i] = view.getUint16(ptr, false) / 65535.0;
        ptr += 2;
      }
      inputTables.push(new SampledCurve(tbl));
    }

    const totalClutEntries = Math.pow(gridPoints, inChannels) * outChannels;
    const clut = new Float64Array(totalClutEntries);
    for (let i = 0; i < totalClutEntries; i++) {
      clut[i] = view.getUint16(ptr, false) / 65535.0;
      ptr += 2;
    }

    const outputTables = [];
    for (let ch = 0; ch < outChannels; ch++) {
      const tbl = new Float64Array(outTableEntries);
      for (let i = 0; i < outTableEntries; i++) {
        tbl[i] = view.getUint16(ptr, false) / 65535.0;
        ptr += 2;
      }
      outputTables.push(new SampledCurve(tbl));
    }

    return new Lut16({
      inChannels,
      outChannels,
      gridPoints,
      matrix,
      inputTables,
      clut,
      outputTables,
    });
  }

  evaluate(inputs) {
    const stage1 = new Array(this.inChannels);
    for (let i = 0; i < this.inChannels; i++) {
      stage1[i] = this.inputTables[i].evaluate(inputs[i] || 0.0);
    }

    const stage2 = new Float64Array(this.outChannels);
    if (this.inChannels === 3) {
      interpolateTetrahedral3D(
        this.clut,
        this.gridPoints,
        this.outChannels,
        stage1[0],
        stage1[1],
        stage1[2],
        stage2
      );
    } else if (this.inChannels === 4) {
      interpolateSimplex4D(
        this.clut,
        this.gridPoints,
        this.outChannels,
        stage1[0],
        stage1[1],
        stage1[2],
        stage1[3],
        stage2
      );
    } else {
      throw new Error(`Unsupported CLUT input dimension: ${this.inChannels}`);
    }

    const results = new Array(this.outChannels);
    for (let i = 0; i < this.outChannels; i++) {
      results[i] = this.outputTables[i].evaluate(stage2[i]);
    }
    return results;
  }
}

/**
 * lutAtoBType (mAB ) parser for ICC v4.
 */
export class LutAtoB extends MultidimensionalLut {
  constructor(fields) {
    super();
    this.inChannels = fields.inChannels;
    this.outChannels = fields.outChannels;
    this.gridPoints = fields.gridPoints;
    this.clut = fields.clut;
    this.bCurves = fields.bCurves; // array of TRC
    this.aCurves = fields.aCurves; // array of TRC
    Object.freeze(this);
  }

  static fromBuffer(buffer, offset = 0) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset);
    const inChannels = view.getUint8(8);
    const outChannels = view.getUint8(9);

    const bCurveOff = view.getUint32(12, false);
    const clutOff = view.getUint32(24, false);
    const aCurveOff = view.getUint32(28, false);

    // Parse B-curves (applied at the end of A-to-B pipeline)
    const bCurves = [];
    if (bCurveOff !== 0) {
      let bPtr = offset + bCurveOff;
      for (let ch = 0; ch < outChannels; ch++) {
        bCurves.push(ToneReproductionCurve.fromBuffer(buffer, bPtr));
        // Align to 4-byte boundary
        bPtr += 12; // Base curve size
      }
    } else {
      for (let ch = 0; ch < outChannels; ch++) {
        bCurves.push(new LinearCurve());
      }
    }

    // Parse CLUT
    let clut = null;
    let gridPoints = 0;
    if (clutOff !== 0) {
      const clutView = new DataView(buffer.buffer, buffer.byteOffset + offset + clutOff);
      gridPoints = clutView.getUint8(0); // 16 grid dimensions supported in spec; read first
      const precision = clutView.getUint8(16); // 1 for 8-bit, 2 for 16-bit

      const totalEntries = Math.pow(gridPoints, inChannels) * outChannels;
      clut = new Float64Array(totalEntries);

      let dataPtr = offset + clutOff + 20;
      if (precision === 1) {
        for (let i = 0; i < totalEntries; i++) {
          clut[i] = buffer[dataPtr + i] / 255.0;
        }
      } else {
        const dView = new DataView(buffer.buffer, buffer.byteOffset + dataPtr);
        for (let i = 0; i < totalEntries; i++) {
          clut[i] = dView.getUint16(i * 2, false) / 65535.0;
        }
      }
    }

    // Parse A-curves (applied at input before CLUT)
    const aCurves = [];
    if (aCurveOff !== 0) {
      let aPtr = offset + aCurveOff;
      for (let ch = 0; ch < inChannels; ch++) {
        aCurves.push(ToneReproductionCurve.fromBuffer(buffer, aPtr));
        aPtr += 12;
      }
    } else {
      for (let ch = 0; ch < inChannels; ch++) {
        aCurves.push(new LinearCurve());
      }
    }

    return new LutAtoB({
      inChannels,
      outChannels,
      gridPoints,
      clut,
      bCurves,
      aCurves,
    });
  }

  evaluate(inputs) {
    // 1. A-curves
    const stage1 = new Array(this.inChannels);
    for (let i = 0; i < this.inChannels; i++) {
      stage1[i] = this.aCurves[i].evaluate(inputs[i] || 0.0);
    }

    // 2. CLUT
    const stage2 = new Float64Array(this.outChannels);
    if (this.clut) {
      if (this.inChannels === 3) {
        interpolateTetrahedral3D(
          this.clut,
          this.gridPoints,
          this.outChannels,
          stage1[0],
          stage1[1],
          stage1[2],
          stage2
        );
      } else if (this.inChannels === 4) {
        interpolateSimplex4D(
          this.clut,
          this.gridPoints,
          this.outChannels,
          stage1[0],
          stage1[1],
          stage1[2],
          stage1[3],
          stage2
        );
      }
    } else {
      for (let i = 0; i < this.outChannels; i++) {
        stage2[i] = stage1[i] || 0.0;
      }
    }

    // 3. B-curves
    const results = new Array(this.outChannels);
    for (let i = 0; i < this.outChannels; i++) {
      results[i] = this.bCurves[i].evaluate(stage2[i]);
    }
    return results;
  }
}

/**
 * lutBtoAType (mBA ) parser for ICC v4.
 */
export class LutBtoA extends MultidimensionalLut {
  constructor(fields) {
    super();
    this.inChannels = fields.inChannels;
    this.outChannels = fields.outChannels;
    this.gridPoints = fields.gridPoints;
    this.clut = fields.clut;
    this.bCurves = fields.bCurves;
    this.aCurves = fields.aCurves;
    Object.freeze(this);
  }

  static fromBuffer(buffer, offset = 0) {
    const view = new DataView(buffer.buffer, buffer.byteOffset + offset);
    const inChannels = view.getUint8(8);
    const outChannels = view.getUint8(9);

    const bCurveOff = view.getUint32(12, false);
    const clutOff = view.getUint32(24, false);
    const aCurveOff = view.getUint32(28, false);

    const bCurves = [];
    if (bCurveOff !== 0) {
      let bPtr = offset + bCurveOff;
      for (let ch = 0; ch < inChannels; ch++) {
        bCurves.push(ToneReproductionCurve.fromBuffer(buffer, bPtr));
        bPtr += 12;
      }
    } else {
      for (let ch = 0; ch < inChannels; ch++) {
        bCurves.push(new LinearCurve());
      }
    }

    let clut = null;
    let gridPoints = 0;
    if (clutOff !== 0) {
      const clutView = new DataView(buffer.buffer, buffer.byteOffset + offset + clutOff);
      gridPoints = clutView.getUint8(0);
      const precision = clutView.getUint8(16);

      const totalEntries = Math.pow(gridPoints, inChannels) * outChannels;
      clut = new Float64Array(totalEntries);

      let dataPtr = offset + clutOff + 20;
      if (precision === 1) {
        for (let i = 0; i < totalEntries; i++) {
          clut[i] = buffer[dataPtr + i] / 255.0;
        }
      } else {
        const dView = new DataView(buffer.buffer, buffer.byteOffset + dataPtr);
        for (let i = 0; i < totalEntries; i++) {
          clut[i] = dView.getUint16(i * 2, false) / 65535.0;
        }
      }
    }

    const aCurves = [];
    if (aCurveOff !== 0) {
      let aPtr = offset + aCurveOff;
      for (let ch = 0; ch < outChannels; ch++) {
        aCurves.push(ToneReproductionCurve.fromBuffer(buffer, aPtr));
        aPtr += 12;
      }
    } else {
      for (let ch = 0; ch < outChannels; ch++) {
        aCurves.push(new LinearCurve());
      }
    }

    return new LutBtoA({
      inChannels,
      outChannels,
      gridPoints,
      clut,
      bCurves,
      aCurves,
    });
  }

  evaluate(inputs) {
    // 1. B-curves
    const stage1 = new Array(this.inChannels);
    for (let i = 0; i < this.inChannels; i++) {
      stage1[i] = this.bCurves[i].evaluate(inputs[i] || 0.0);
    }

    // 2. CLUT
    const stage2 = new Float64Array(this.outChannels);
    if (this.clut) {
      if (this.inChannels === 3) {
        interpolateTetrahedral3D(
          this.clut,
          this.gridPoints,
          this.outChannels,
          stage1[0],
          stage1[1],
          stage1[2],
          stage2
        );
      } else if (this.inChannels === 4) {
        interpolateSimplex4D(
          this.clut,
          this.gridPoints,
          this.outChannels,
          stage1[0],
          stage1[1],
          stage1[2],
          stage1[3],
          stage2
        );
      }
    } else {
      for (let i = 0; i < this.outChannels; i++) {
        stage2[i] = stage1[i] || 0.0;
      }
    }

    // 3. A-curves
    const results = new Array(this.outChannels);
    for (let i = 0; i < this.outChannels; i++) {
      results[i] = this.aCurves[i].evaluate(stage2[i]);
    }
    return results;
  }
}
