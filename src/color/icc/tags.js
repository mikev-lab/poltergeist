/**
 * @fileoverview ICC Tag Table Directory and Tag Deserializers.
 */

import { XyzColor } from '../../types/color.js';
import { readAscii4, readS15Fixed16, writeS15Fixed16 } from './header.js';
import { ToneReproductionCurve } from './trc.js';
import { MultidimensionalLut } from './lut.js';

const parsedCache = new WeakMap();

/**
 * Parses an XYZType tag ('XYZ ').
 * @param {Uint8Array} buffer
 * @param {number} offset
 * @returns {XyzColor}
 */
export function parseXyzTag(buffer, offset) {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset);
  const sig = readAscii4(view, 0);
  if (sig !== 'XYZ ') {
    throw new Error(`Expected 'XYZ ' tag type, encountered '${sig}'`);
  }
  const x = readS15Fixed16(view, 8);
  const y = readS15Fixed16(view, 12);
  const z = readS15Fixed16(view, 16);
  return new XyzColor(x, y, z);
}

/**
 * Parses a text description tag ('desc' or 'mluc').
 * @param {Uint8Array} buffer
 * @param {number} offset
 * @returns {string}
 */
export function parseDescTag(buffer, offset) {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset);
  const sig = readAscii4(view, 0);

  if (sig === 'desc') {
    const asciiLength = view.getUint32(8, false);
    let str = '';
    for (let i = 0; i < asciiLength; i++) {
      const code = buffer[offset + 12 + i];
      if (code === 0) break;
      str += String.fromCharCode(code);
    }
    return str;
  } else if (sig === 'mluc') {
    const recordCount = view.getUint32(8, false);
    if (recordCount === 0) return '';
    // First record: len (u32) at 16, offset at 20 (relative to tag start)
    const strLen = view.getUint32(16, false);
    const strOff = view.getUint32(20, false);
    let str = '';
    const dView = new DataView(buffer.buffer, buffer.byteOffset + offset + strOff);
    for (let i = 0; i < strLen / 2; i++) {
      str += String.fromCharCode(dView.getUint16(i * 2, false));
    }
    return str;
  } else if (sig === 'text') {
    // Pure ASCII
    let str = '';
    for (let i = 8; i < buffer.length; i++) {
      const code = buffer[offset + i];
      if (code === 0) break;
      str += String.fromCharCode(code);
    }
    return str;
  }
  return '';
}

/**
 * Represents a single ICC Tag entry.
 */
export class IccTagEntry {
  /**
   * @param {string} signature 4-character tag identifier (e.g. 'rXYZ', 'desc', 'A2B0')
   * @param {number} offset Byte offset from start of ICC profile
   * @param {number} length Byte length of tag data
   * @param {Uint8Array} rawData Raw slice containing tag payload
   */
  constructor(signature, offset, length, rawData) {
    this.signature = signature;
    this.offset = offset;
    this.length = length;
    this.rawData = rawData;
    Object.freeze(this);
  }

  /**
   * Returns the parsed representation of this tag.
   * @returns {*}
   */
  get parsed() {
    if (parsedCache.has(this)) return parsedCache.get(this);

    const view = new DataView(this.rawData.buffer, this.rawData.byteOffset, this.rawData.length);
    const typeSig = readAscii4(view, 0);
    let parsed;

    if (typeSig === 'XYZ ') {
      parsed = parseXyzTag(this.rawData, 0);
    } else if (typeSig === 'curv' || typeSig === 'para') {
      parsed = ToneReproductionCurve.fromBuffer(this.rawData, 0);
    } else if (typeSig === 'mft1' || typeSig === 'mft2' || typeSig === 'mAB ' || typeSig === 'mBA ') {
      parsed = MultidimensionalLut.fromBuffer(this.rawData, 0);
    } else if (typeSig === 'desc' || typeSig === 'mluc' || typeSig === 'text') {
      parsed = parseDescTag(this.rawData, 0);
    } else {
      parsed = this.rawData;
    }
    parsedCache.set(this, parsed);
    return parsed;
  }
}

/**
 * Parses the tag table directory from an ICC profile buffer.
 * @param {Uint8Array} buffer Complete ICC profile buffer
 * @returns {Map<string, IccTagEntry>} Map of tag signatures to tag entries
 */
export function parseTagTable(buffer) {
  if (buffer.length < 132) {
    throw new RangeError(`Buffer too small for ICC tag table: ${buffer.length} bytes`);
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
  const tagCount = view.getUint32(128, false);

  const tags = new Map();
  let ptr = 132;

  for (let i = 0; i < tagCount; i++) {
    if (ptr + 12 > buffer.length) {
      throw new RangeError(`Truncated tag directory at index ${i}`);
    }

    const signature = readAscii4(view, ptr);
    const offset = view.getUint32(ptr + 4, false);
    const length = view.getUint32(ptr + 8, false);
    ptr += 12;

    if (offset + length > buffer.length) {
      throw new RangeError(
        `Tag '${signature}' bounds [${offset}, ${offset + length}] exceed buffer length ${buffer.length}`
      );
    }

    const rawData = buffer.subarray(offset, offset + length);
    tags.set(signature, new IccTagEntry(signature, offset, length, rawData));
  }

  return tags;
}
