/**
 * @file index.js
 * @description Unified layered graphic format sniffer and router for Poltergeist.
 * Zero-dependency, memory-safe.
 */

import { PsdDecoder } from './psd/psd_decoder.js';
import { ClipDecoder } from './clip/clip_decoder.js';
import { XcfDecoder } from './xcf/xcf_decoder.js';

export { PsdDecoder, ClipDecoder, XcfDecoder };

/**
 * Sniffs binary magic bytes and decodes any supported layered format (PSD, PSB, CLIP, XCF).
 * @param {Uint8Array|Buffer} buffer 
 * @param {object} [options]
 * @returns {import('../../types/layer.js').LayeredImage}
 */
export function decodeLayered(buffer, options = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 4) {
    throw new Error('Buffer too small to determine layered image format.');
  }

  // Photoshop PSD / PSB: '8BPS'
  if (bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53) {
    return PsdDecoder.decode(bytes, options);
  }

  // Clip Studio Paint: SQLite 3 format header ("SQLite format 3\0")
  if (bytes.length >= 16) {
    const isSqlite = bytes[0] === 0x53 && bytes[1] === 0x51 && bytes[2] === 0x4c && bytes[3] === 0x69 &&
                     bytes[4] === 0x74 && bytes[5] === 0x65 && bytes[6] === 0x20 && bytes[7] === 0x66 &&
                     bytes[8] === 0x6f && bytes[9] === 0x72 && bytes[10] === 0x6d && bytes[11] === 0x61 &&
                     bytes[12] === 0x74 && bytes[13] === 0x20 && bytes[14] === 0x33 && bytes[15] === 0x00;
    if (isSqlite) {
      return ClipDecoder.decode(bytes, options);
    }
  }

  // GIMP XCF: 'gimp xcf '
  if (bytes.length >= 9) {
    const isXcf = bytes[0] === 0x67 && bytes[1] === 0x69 && bytes[2] === 0x6d && bytes[3] === 0x70 &&
                  bytes[4] === 0x20 && bytes[5] === 0x78 && bytes[6] === 0x63 && bytes[7] === 0x66 &&
                  bytes[8] === 0x20;
    if (isXcf) {
      return XcfDecoder.decode(bytes, options);
    }
  }

  throw new Error('Unsupported or unrecognized layered image format.');
}
