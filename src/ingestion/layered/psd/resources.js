/**
 * @file resources.js
 * @description Image Resources block parser for Adobe PSD / PSB.
 * Extracts ResolutionInfo (DPI) and embedded ICC profiles.
 */

import { IccProfile } from '../../../color/icc/profile.js';

export class PsdResources {
  constructor() {
    this.dpiX = 300;
    this.dpiY = 300;
    this.iccProfile = null;
  }

  /**
   * Parses the Image Resources block.
   * @param {Uint8Array} bytes 
   * @param {number} startOffset 
   * @param {number} sectionLength 
   * @returns {PsdResources}
   */
  static parse(bytes, startOffset, sectionLength) {
    const res = new PsdResources();
    let offset = startOffset;
    const end = startOffset + sectionLength;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    while (offset + 12 <= end) {
      // Check 8BIM
      if (bytes[offset] !== 0x38 || bytes[offset + 1] !== 0x42 ||
          bytes[offset + 2] !== 0x49 || bytes[offset + 3] !== 0x4d) {
        break;
      }

      const resourceId = view.getUint16(offset + 4, false);
      offset += 6;

      // Pascal string: 1 byte length + string, padded to even
      const nameLen = bytes[offset++];
      let nameBytes = nameLen;
      offset += nameBytes;
      if ((nameBytes + 1) & 1) offset++; // Pad to even

      if (offset + 4 > end) break;
      const dataSize = view.getUint32(offset, false);
      offset += 4;

      const dataEnd = offset + dataSize;
      if (dataEnd > end) break;

      if (resourceId === 0x03ed && dataSize >= 16) { // ResolutionInfo
        const hRes = view.getUint32(offset, false) / 65536.0;
        const vRes = view.getUint32(offset + 8, false) / 65536.0;
        if (hRes > 0) res.dpiX = Math.round(hRes);
        if (vRes > 0) res.dpiY = Math.round(vRes);
      } else if (resourceId === 0x040f && dataSize > 128) { // ICC Profile
        try {
          const iccBytes = bytes.subarray(offset, dataEnd);
          res.iccProfile = IccProfile.fromBuffer(iccBytes);
        } catch {
          // Non-fatal
        }
      }

      offset = dataEnd + (dataSize & 1); // Pad to even
    }

    return res;
  }
}
