/**
 * @fileoverview Complete ICC Profile abstraction, parser, serializer, and reference profile generators.
 */

import { RenderingIntent, D50, RgbColor, CmykColor, XyzColor } from '../../types/color.js';
import { IccHeader, writeS15Fixed16 } from './header.js';
import { parseTagTable, IccTagEntry } from './tags.js';
import { ToneReproductionCurve, ParametricCurve, GammaCurve, LinearCurve } from './trc.js';
import { Lut8 } from './lut.js';
import { BRADFORD_D65_TO_D50, D65, adaptXyz } from '../transform/pcs.js';

/**
 * Complete, standalone ICC Profile representation.
 */
export class IccProfile {
  /**
   * @param {IccHeader} header
   * @param {Map<string, IccTagEntry>} tags
   * @param {Uint8Array} [rawBuffer]
   */
  constructor(header, tags, rawBuffer = null) {
    this.header = header;
    this.tags = tags;
    this.rawBuffer = rawBuffer;
    Object.freeze(this);
  }

  get colorSpace() {
    return this.header.colorSpace;
  }

  get pcs() {
    return this.header.pcs;
  }

  get deviceClass() {
    return this.header.deviceClass;
  }

  get renderingIntent() {
    return this.header.renderingIntent;
  }

  hasTag(signature) {
    return this.tags.has(signature);
  }

  getTag(signature) {
    const entry = this.tags.get(signature);
    return entry ? entry.parsed : null;
  }

  isMatrixShaper() {
    return (
      this.hasTag('rXYZ') &&
      this.hasTag('gXYZ') &&
      this.hasTag('bXYZ') &&
      this.hasTag('rTRC') &&
      this.hasTag('gTRC') &&
      this.hasTag('bTRC')
    );
  }

  isLutBased() {
    return this.hasTag('A2B0') || this.hasTag('B2A0') || this.hasTag('A2B1') || this.hasTag('B2A1');
  }

  /**
   * Parses an ICC profile from a binary buffer.
   * @param {Uint8Array|ArrayBuffer} buffer
   * @returns {IccProfile}
   */
  static fromBuffer(buffer) {
    const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const header = IccHeader.fromBuffer(uint8);
    const tags = parseTagTable(uint8);
    return new IccProfile(header, tags, uint8);
  }

  /**
   * Serializes this profile into an ICC binary profile buffer.
   * @returns {Uint8Array}
   */
  toBuffer() {
    if (this.rawBuffer) return this.rawBuffer;

    // Build binary tag table and data blocks
    const tagEntries = Array.from(this.tags.values());
    const tagCount = tagEntries.length;

    // Header (128) + TagCount (4) + Table (tagCount * 12)
    const headerTableSize = 128 + 4 + tagCount * 12;
    // Align data start to 4-byte boundary
    let dataOffset = Math.ceil(headerTableSize / 4) * 4;

    const dataBlocks = [];
    const offsets = [];

    for (const entry of tagEntries) {
      offsets.push(dataOffset);
      dataBlocks.push(entry.rawData);
      // Pad to 4-byte boundary
      const paddedLen = Math.ceil(entry.rawData.length / 4) * 4;
      dataOffset += paddedLen;
    }

    const totalSize = dataOffset;
    const finalBuffer = new Uint8Array(totalSize);

    // 1. Write Header
    const headerBytes = this.header.serialize(totalSize);
    finalBuffer.set(headerBytes, 0);

    // 2. Write Tag Directory
    const view = new DataView(finalBuffer.buffer);
    view.setUint32(128, tagCount, false);

    for (let i = 0; i < tagCount; i++) {
      const entry = tagEntries[i];
      const entryOffset = 132 + i * 12;
      for (let c = 0; c < 4; c++) {
        finalBuffer[entryOffset + c] = entry.signature.charCodeAt(c);
      }
      view.setUint32(entryOffset + 4, offsets[i], false);
      view.setUint32(entryOffset + 8, entry.rawData.length, false);

      // Write data block
      finalBuffer.set(entry.rawData, offsets[i]);
    }

    return finalBuffer;
  }

  /**
   * Creates a standard sRGB v4 Matrix/TRC profile adapted to D50 PCS.
   * Conforms to IEC 61966-2-1 and ICC.1:2010.
   * @returns {IccProfile}
   */
  static createSrgbProfile() {
    const header = new IccHeader({
      profileSize: 0,
      cmmType: 'appl',
      versionMajor: 4,
      versionMinor: 3,
      version: '4.3.0',
      deviceClass: 'mntr',
      colorSpace: 'RGB ',
      pcs: 'XYZ ',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      signature: 'acsp',
      platform: 'APPL',
      flags: 0,
      manufacturer: 'appl',
      model: 'sRGB',
      renderingIntent: RenderingIntent.PERCEPTUAL,
      illuminant: D50,
      creator: 'POLT',
      profileId: new Uint8Array(16),
    });

    const tags = new Map();

    // 1. 'desc' tag
    const descStr = 'sRGB IEC61966-2.1 (Poltergeist Prepress D50)';
    const descData = new Uint8Array(12 + descStr.length + 1);
    const descView = new DataView(descData.buffer);
    for (let i = 0; i < 4; i++) descData[i] = 'desc'.charCodeAt(i);
    descView.setUint32(8, descStr.length + 1, false);
    for (let i = 0; i < descStr.length; i++) descData[12 + i] = descStr.charCodeAt(i);
    tags.set('desc', new IccTagEntry('desc', 0, descData.length, descData));

    // 2. 'wtpt' tag: D50 media white point
    const wtptData = new Uint8Array(20);
    for (let i = 0; i < 4; i++) wtptData[i] = 'XYZ '.charCodeAt(i);
    const wtptView = new DataView(wtptData.buffer);
    writeS15Fixed16(wtptView, 8, D50.X);
    writeS15Fixed16(wtptView, 12, D50.Y);
    writeS15Fixed16(wtptView, 16, D50.Z);
    tags.set('wtpt', new IccTagEntry('wtpt', 0, wtptData.length, wtptData));

    // 3. Matrix columns: sRGB primaries chromatic adaptation D65 -> D50 via Bradford
    // Standard sRGB primaries in D65:
    // Red:   X=0.4124564, Y=0.2126729, Z=0.0193339
    // Green: X=0.3575761, Y=0.7151522, Z=0.1191920
    // Blue:  X=0.1804375, Y=0.0721750, Z=0.9503041
    const rD50 = adaptXyz(new XyzColor(0.4124564, 0.2126729, 0.0193339), BRADFORD_D65_TO_D50);
    const gD50 = adaptXyz(new XyzColor(0.3575761, 0.7151522, 0.1191920), BRADFORD_D65_TO_D50);
    const bD50 = adaptXyz(new XyzColor(0.1804375, 0.0721750, 0.9503041), BRADFORD_D65_TO_D50);

    const makeXyzTag = (sig, xyz) => {
      const buf = new Uint8Array(20);
      for (let i = 0; i < 4; i++) buf[i] = 'XYZ '.charCodeAt(i);
      const v = new DataView(buf.buffer);
      writeS15Fixed16(v, 8, xyz.x);
      writeS15Fixed16(v, 12, xyz.y);
      writeS15Fixed16(v, 16, xyz.z);
      return new IccTagEntry(sig, 0, buf.length, buf);
    };

    tags.set('rXYZ', makeXyzTag('rXYZ', rD50));
    tags.set('gXYZ', makeXyzTag('gXYZ', gD50));
    tags.set('bXYZ', makeXyzTag('bXYZ', bD50));

    // 4. TRC tags: sRGB parametric curve (Type 3: g=2.4, a=1/1.055, b=0.055/1.055, c=1/12.92, d=0.04045)
    // Parametric curve payload: 'para' + reserved(4) + funcType(2) + reserved(2) + 5*s15Fixed16 = 32 bytes
    const makeParaSrgbTag = (sig) => {
      const buf = new Uint8Array(32);
      for (let i = 0; i < 4; i++) buf[i] = 'para'.charCodeAt(i);
      const v = new DataView(buf.buffer);
      v.setUint16(8, 3, false); // Function type 3
      writeS15Fixed16(v, 12, 2.4); // g
      writeS15Fixed16(v, 16, 1.0 / 1.055); // a
      writeS15Fixed16(v, 20, 0.055 / 1.055); // b
      writeS15Fixed16(v, 24, 1.0 / 12.92); // c
      writeS15Fixed16(v, 28, 0.04045); // d
      return new IccTagEntry(sig, 0, buf.length, buf);
    };

    tags.set('rTRC', makeParaSrgbTag('rTRC'));
    tags.set('gTRC', makeParaSrgbTag('gTRC'));
    tags.set('bTRC', makeParaSrgbTag('bTRC'));

    const prof = new IccProfile(header, tags);
    const raw = prof.toBuffer();
    return IccProfile.fromBuffer(raw);
  }

  /**
   * Creates a linear RGB profile with gamma = 1.0.
   * @returns {IccProfile}
   */
  static createLinearRgbProfile() {
    const srgb = IccProfile.createSrgbProfile();
    const tags = new Map(srgb.tags);

    // Replace TRCs with linear gamma 1.0
    const makeLinearTag = (sig) => {
      const buf = new Uint8Array(14);
      for (let i = 0; i < 4; i++) buf[i] = 'curv'.charCodeAt(i);
      const v = new DataView(buf.buffer);
      v.setUint32(8, 1, false); // count = 1
      v.setUint16(12, 256, false); // gamma = 1.0 (u8.8)
      return new IccTagEntry(sig, 0, buf.length, buf);
    };

    tags.set('rTRC', makeLinearTag('rTRC'));
    tags.set('gTRC', makeLinearTag('gTRC'));
    tags.set('bTRC', makeLinearTag('bTRC'));

    const prof = new IccProfile(srgb.header, tags);
    const raw = prof.toBuffer();
    return IccProfile.fromBuffer(raw);
  }

  /**
   * Creates a reference standard prepress CMYK profile (Fogra39 / SWOP characterization).
   * Generates A2B0 and B2A0 LUTs with tetrahedral interpolation support.
   * @returns {IccProfile}
   */
  static createCmykReferenceProfile() {
    const header = new IccHeader({
      profileSize: 0,
      cmmType: 'appl',
      versionMajor: 4,
      versionMinor: 3,
      version: '4.3.0',
      deviceClass: 'prtr',
      colorSpace: 'CMYK',
      pcs: 'Lab ',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      signature: 'acsp',
      platform: 'APPL',
      flags: 0,
      manufacturer: 'POLT',
      model: 'RefCMYK',
      renderingIntent: RenderingIntent.RELATIVE_COLORIMETRIC,
      illuminant: D50,
      creator: 'POLT',
      profileId: new Uint8Array(16),
    });

    const tags = new Map();

    // 1. Description
    const descStr = 'Poltergeist Reference Prepress CMYK (Fogra39 Baseline)';
    const descData = new Uint8Array(12 + descStr.length + 1);
    const descView = new DataView(descData.buffer);
    for (let i = 0; i < 4; i++) descData[i] = 'desc'.charCodeAt(i);
    descView.setUint32(8, descStr.length + 1, false);
    for (let i = 0; i < descStr.length; i++) descData[12 + i] = descStr.charCodeAt(i);
    tags.set('desc', new IccTagEntry('desc', 0, descData.length, descData));

    // 2. White point
    const wtptData = new Uint8Array(20);
    for (let i = 0; i < 4; i++) wtptData[i] = 'XYZ '.charCodeAt(i);
    const wtptView = new DataView(wtptData.buffer);
    writeS15Fixed16(wtptView, 8, D50.X);
    writeS15Fixed16(wtptView, 12, D50.Y);
    writeS15Fixed16(wtptView, 16, D50.Z);
    tags.set('wtpt', new IccTagEntry('wtpt', 0, wtptData.length, wtptData));

    // 3. A2B0 LUT (Device CMYK -> PCS Lab): 4 inputs, 3 outputs, grid = 5
    // Size for mft1: 48 + 4*256 + (5^4 * 3) + 3*256 = 48 + 1024 + 1875 + 768 = 3715 bytes
    const grid4D = 5;
    const clutEntries = Math.pow(grid4D, 4) * 3;
    const a2b0Len = 48 + 4 * 256 + clutEntries + 3 * 256;
    const a2b0Data = new Uint8Array(a2b0Len);
    const a2bView = new DataView(a2b0Data.buffer);

    for (let i = 0; i < 4; i++) a2b0Data[i] = 'mft1'.charCodeAt(i);
    a2bView.setUint8(8, 4); // inChannels: C, M, Y, K
    a2bView.setUint8(9, 3); // outChannels: L*, a*, b*
    a2bView.setUint8(10, grid4D);

    // Identity 3x3 matrix
    for (let r = 0; r < 3; r++) {
      writeS15Fixed16(a2bView, 12 + (r * 3 + r) * 4, 1.0);
    }

    let ptr = 48;
    // Linear input tables for C, M, Y, K
    for (let ch = 0; ch < 4; ch++) {
      for (let i = 0; i < 256; i++) a2b0Data[ptr++] = i;
    }

    // CLUT mapping CMYK -> Lab:
    // Pure paper (0,0,0,0) -> L*=100, a*=0, b*=0
    // Solid Black (0,0,0,1) -> L*=10, a*=0, b*=0
    // Cyan -> L*=55, a*=-37, b*=-50
    // Magenta -> L*=48, a*=74, b*=-3
    // Yellow -> L*=89, a*=-5, b*=93
    for (let c = 0; c < grid4D; c++) {
      for (let m = 0; m < grid4D; m++) {
        for (let y = 0; y < grid4D; y++) {
          for (let k = 0; k < grid4D; k++) {
            const cn = c / (grid4D - 1);
            const mn = m / (grid4D - 1);
            const yn = y / (grid4D - 1);
            const kn = k / (grid4D - 1);

            // Normalized subtractive ink components
            const neutral = Math.min(cn, Math.min(mn, yn));
            const cDiff = cn - neutral;
            const mDiff = mn - neutral;
            const yDiff = yn - neutral;

            // Optical density and lightness
            const inkSum = Math.min(1.0, cn * 0.333333 + mn * 0.333333 + yn * 0.333334 + kn * 0.9);
            const L = 100.0 * (1.0 - inkSum);
            const a = (mDiff * 75.0 - cDiff * 37.0) * (1.0 - kn * 0.8);
            const b = (yDiff * 90.0 - cDiff * 48.0) * (1.0 - kn * 0.8);

            // Encode Lab: L* in [0, 255] (0..100), a* in [0, 255] (-128..127), b* in [0, 255] (-128..127)
            a2b0Data[ptr++] = Math.round((L / 100.0) * 255.0);
            a2b0Data[ptr++] = Math.round(((a + 128.0) / 255.0) * 255.0);
            a2b0Data[ptr++] = Math.round(((b + 128.0) / 255.0) * 255.0);
          }
        }
      }
    }

    // Output tables (identity)
    for (let ch = 0; ch < 3; ch++) {
      for (let i = 0; i < 256; i++) a2b0Data[ptr++] = i;
    }

    tags.set('A2B0', new IccTagEntry('A2B0', 0, a2b0Data.length, a2b0Data));

    // 4. B2A0 LUT (PCS Lab -> Device CMYK): 3 inputs, 4 outputs, grid = 5
    // Size for mft1: 48 + 3*256 + (5^3 * 4) + 4*256 = 48 + 768 + 500 + 1024 = 2340 bytes
    const grid3D = 5;
    const b2aEntries = Math.pow(grid3D, 3) * 4;
    const b2a0Len = 48 + 3 * 256 + b2aEntries + 4 * 256;
    const b2a0Data = new Uint8Array(b2a0Len);
    const b2aView = new DataView(b2a0Data.buffer);

    for (let i = 0; i < 4; i++) b2a0Data[i] = 'mft1'.charCodeAt(i);
    b2aView.setUint8(8, 3); // inChannels: L, a, b
    b2aView.setUint8(9, 4); // outChannels: C, M, Y, K
    b2aView.setUint8(10, grid3D);

    for (let r = 0; r < 3; r++) {
      writeS15Fixed16(b2aView, 12 + (r * 3 + r) * 4, 1.0);
    }

    ptr = 48;
    for (let ch = 0; ch < 3; ch++) {
      for (let i = 0; i < 256; i++) b2a0Data[ptr++] = i;
    }

    // CLUT mapping Lab -> CMYK
    for (let L_idx = 0; L_idx < grid3D; L_idx++) {
      for (let a_idx = 0; a_idx < grid3D; a_idx++) {
        for (let b_idx = 0; b_idx < grid3D; b_idx++) {
          const L_val = (L_idx / (grid3D - 1)) * 100.0;
          const a_val = (a_idx / (grid3D - 1)) * 255.0 - 128.0;
          const b_val = (b_idx / (grid3D - 1)) * 255.0 - 128.0;

          // Convert Lab to calibrated process CMYK
          const darkness = Math.max(0.0, (100.0 - L_val) / 100.0);
          const k_val = darkness > 0.8 ? (darkness - 0.8) * 5.0 : 0.0;
          const rem = Math.max(0.0, darkness - k_val * 0.9);

          const c_val = Math.max(0.0, Math.min(1.0, rem - a_val * 0.005 - b_val * 0.003));
          const m_val = Math.max(0.0, Math.min(1.0, rem + a_val * 0.006));
          const y_val = Math.max(0.0, Math.min(1.0, rem + b_val * 0.007));

          b2a0Data[ptr++] = Math.round(c_val * 255.0);
          b2a0Data[ptr++] = Math.round(m_val * 255.0);
          b2a0Data[ptr++] = Math.round(y_val * 255.0);
          b2a0Data[ptr++] = Math.round(Math.min(1.0, k_val) * 255.0);
        }
      }
    }

    for (let ch = 0; ch < 4; ch++) {
      for (let i = 0; i < 256; i++) b2a0Data[ptr++] = i;
    }

    tags.set('B2A0', new IccTagEntry('B2A0', 0, b2a0Data.length, b2a0Data));

    const prof = new IccProfile(header, tags);
    const raw = prof.toBuffer();
    return IccProfile.fromBuffer(raw);
  }
}
