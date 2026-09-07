/**
 * @file rle.js
 * @description Photoshop PackBits RLE channel decompressor for Poltergeist.
 * Strictly zero-dependency, memory-safe, supports both 16-bit (PSD) and 32-bit (PSB) scanline lengths.
 */

/**
 * Decompresses a single PackBits scanline.
 * @param {Uint8Array} src 
 * @param {number} srcOffset 
 * @param {number} srcLength 
 * @param {Uint8Array} dest 
 * @param {number} destOffset 
 * @param {number} expectedLength 
 */
export function decompressPsdPackBits(src, srcOffset, srcLength, dest, destOffset, expectedLength) {
  let inPos = srcOffset;
  const inEnd = srcOffset + srcLength;
  let outPos = destOffset;
  const outEnd = destOffset + expectedLength;

  while (inPos < inEnd && outPos < outEnd) {
    const n = (src[inPos++] << 24) >> 24; // signed int8
    if (n >= 0 && n <= 127) {
      const count = n + 1;
      for (let i = 0; i < count && outPos < outEnd && inPos < inEnd; i++) {
        dest[outPos++] = src[inPos++];
      }
    } else if (n >= -127 && n <= -1) {
      const count = -n + 1;
      if (inPos < inEnd) {
        const val = src[inPos++];
        for (let i = 0; i < count && outPos < outEnd; i++) {
          dest[outPos++] = val;
        }
      }
    }
    // n === -128 is a no-op
  }
}

export class PsdPackBits {
  /**
   * @param {Uint8Array} src
   * @param {number} expectedLength
   * @returns {Uint8Array}
   */
  static decompress(src, expectedLength) {
    const dest = new Uint8Array(expectedLength);
    decompressPsdPackBits(src, 0, src.length, dest, 0, expectedLength);
    return dest;
  }
}
