/**
 * @file header.js
 * @description 26-byte PSD / PSB header parser for Poltergeist.
 * Strictly zero-dependency and memory-safe.
 */

import { ColorSpaceType } from '../../../types/image.js';

export const PsdColorMode = Object.freeze({
  BITMAP: 0,
  GRAYSCALE: 1,
  INDEXED: 2,
  RGB: 3,
  CMYK: 4,
  MULTICHANNEL: 7,
  DUOTONE: 8,
  LAB: 9
});

export class PsdHeader {
  /**
   * @param {object} params
   * @param {number} params.version
   * @param {number} params.channels
   * @param {number} params.height
   * @param {number} params.width
   * @param {number} params.depth
   * @param {number} params.colorMode
   */
  constructor({ version, channels, height, width, depth, colorMode }) {
    this.version = version;
    this.isPsb = version === 2;
    this.channels = channels;
    this.height = height;
    this.width = width;
    this.depth = depth;
    this.colorMode = colorMode;

    switch (colorMode) {
      case PsdColorMode.CMYK:
        this.colorSpace = ColorSpaceType.CMYK;
        break;
      case PsdColorMode.GRAYSCALE:
        this.colorSpace = ColorSpaceType.GRAY;
        break;
      case PsdColorMode.INDEXED:
        this.colorSpace = ColorSpaceType.INDEXED;
        break;
      case PsdColorMode.RGB:
      default:
        this.colorSpace = ColorSpaceType.RGB;
        break;
    }

    Object.freeze(this);
  }

  /**
   * Parses the 26-byte PSD/PSB header.
   * @param {Uint8Array} bytes 
   * @returns {PsdHeader}
   */
  static fromBuffer(bytes) {
    if (bytes.length < 26) {
      throw new Error(`PSD header truncated: buffer length ${bytes.length} is less than 26 bytes.`);
    }

    // Magic: 8BPS
    if (bytes[0] !== 0x38 || bytes[1] !== 0x42 || bytes[2] !== 0x50 || bytes[3] !== 0x53) {
      throw new Error(`Invalid PSD signature: expected '8BPS', got 0x${bytes[0].toString(16)} 0x${bytes[1].toString(16)}.`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint16(4, false);
    if (version !== 1 && version !== 2) {
      throw new Error(`Unsupported PSD version: ${version}. Expected 1 (PSD) or 2 (PSB).`);
    }

    const channels = view.getUint16(12, false);
    const height = view.getUint32(14, false);
    const width = view.getUint32(18, false);
    const depth = view.getUint16(22, false);
    const colorMode = view.getUint16(24, false);

    const maxDim = version === 2 ? 300000 : 30000;
    if (width <= 0 || width > maxDim || height <= 0 || height > maxDim) {
      throw new Error(`Invalid PSD dimensions: ${width}x${height} (max allowed: ${maxDim})`);
    }

    return new PsdHeader({ version, channels, height, width, depth, colorMode });
  }
}
