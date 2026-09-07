/**
 * @file wmf_decoder.js
 * @description Windows Metafile (WMF) and Enhanced Metafile (EMF) vector decoder for Poltergeist.
 * Strictly zero-dependency and memory-safe.
 */

import { VectorPath } from '../../types/vector.js';
import { Document, PageRecord, PageBox } from '../../types/document.js';
import { ColorSpaceType } from '../../types/image.js';

const WMF_APM_MAGIC = 0x9AC6CDD7; // LE: 0xD7, 0xCD, 0xC6, 0x9A
const EMF_SIGNATURE = 0x28464D45; // 'EMF\x28' or ' EMF'

export class WmfDecoder {
  /**
   * Sniffs whether buffer is a WMF or EMF file.
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!buffer || buffer.length < 24) return false;
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // 1. Placeable WMF (APM)
    if (view.getUint32(0, true) === WMF_APM_MAGIC) {
      return true;
    }

    // 2. Standard WMF (Type=1 or 2, HeaderSize=9)
    const fileType = view.getUint16(0, true);
    const headerSize = view.getUint16(2, true);
    if ((fileType === 1 || fileType === 2) && headerSize === 9) {
      return true;
    }

    // 3. EMF: starts with EMR_HEADER (type 1) and has EMF signature at offset 40
    if (buffer.length >= 44 && view.getUint32(0, true) === 1) {
      if (view.getUint32(40, true) === EMF_SIGNATURE) {
        return true;
      }
    }

    return false;
  }

  /**
   * Decodes a WMF or EMF buffer into a Document model.
   * @param {Uint8Array} buffer
   * @param {object} [options]
   * @returns {Document}
   */
  static decode(buffer, options = {}) {
    if (!WmfDecoder.probe(buffer)) {
      throw new Error('Unsupported or invalid WMF/EMF file format.');
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // Check if EMF
    if (buffer.length >= 44 && view.getUint32(0, true) === 1 && view.getUint32(40, true) === EMF_SIGNATURE) {
      return WmfDecoder._decodeEmf(buffer, options);
    }

    return WmfDecoder._decodeWmf(buffer, options);
  }

  /**
   * @private
   */
  static _decodeWmf(buffer, options) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let offset = 0;
    let unitsPerInch = 1440;
    let left = 0, top = 0, right = 1000, bottom = 1000;

    // Placeable WMF APM header (22 bytes)
    if (view.getUint32(0, true) === WMF_APM_MAGIC) {
      left = view.getInt16(6, true);
      top = view.getInt16(8, true);
      right = view.getInt16(10, true);
      bottom = view.getInt16(12, true);
      unitsPerInch = view.getUint16(14, true) || 1440;
      offset = 22;
    }

    // Standard WMF header (18 bytes)
    if (offset + 18 > buffer.length) {
      throw new RangeError('Truncated WMF header.');
    }

    const wmfHeaderSize = view.getUint16(offset + 2, true) * 2; // in bytes
    offset += 18;

    const scale = 72.0 / unitsPerInch;
    const widthPts = Math.max(1, Math.abs(right - left) * scale);
    const heightPts = Math.max(1, Math.abs(bottom - top) * scale);

    const paths = [];
    let curPath = new VectorPath();

    // Iterate WMF records
    while (offset + 6 <= buffer.length) {
      const recordSizeWords = view.getUint32(offset, true);
      const recordBytes = recordSizeWords * 2;
      const func = view.getUint16(offset + 4, true);

      if (recordBytes < 6 || offset + recordBytes > buffer.length) {
        break; // Guard against corrupted record lengths
      }

      if (func === 0x0000) { // META_EOF
        break;
      } else if (func === 0x0214) { // META_MOVETO (y: int16, x: int16)
        const y = view.getInt16(offset + 6, true) * scale;
        const x = view.getInt16(offset + 8, true) * scale;
        curPath = new VectorPath();
        curPath.moveTo(x, y);
        paths.push(curPath);
      } else if (func === 0x0213) { // META_LINETO (y: int16, x: int16)
        const y = view.getInt16(offset + 6, true) * scale;
        const x = view.getInt16(offset + 8, true) * scale;
        curPath.lineTo(x, y);
      } else if (func === 0x041B) { // META_RECTANGLE (bottom, right, top, left)
        const b = view.getInt16(offset + 6, true) * scale;
        const r = view.getInt16(offset + 8, true) * scale;
        const t = view.getInt16(offset + 10, true) * scale;
        const l = view.getInt16(offset + 12, true) * scale;
        const rectPath = new VectorPath();
        rectPath.moveTo(l, t);
        rectPath.lineTo(r, t);
        rectPath.lineTo(r, b);
        rectPath.lineTo(l, b);
        rectPath.closePath();
        paths.push(rectPath);
      } else if (func === 0x0325 || func === 0x0324) { // META_POLYLINE (0x0325) or META_POLYGON (0x0324)
        const count = view.getInt16(offset + 6, true);
        if (count > 0 && offset + 8 + count * 4 <= buffer.length) {
          const polyPath = new VectorPath();
          let ptOffset = offset + 8;
          const x0 = view.getInt16(ptOffset, true) * scale;
          const y0 = view.getInt16(ptOffset + 2, true) * scale;
          polyPath.moveTo(x0, y0);
          for (let p = 1; p < count; p++) {
            ptOffset += 4;
            const px = view.getInt16(ptOffset, true) * scale;
            const py = view.getInt16(ptOffset + 2, true) * scale;
            polyPath.lineTo(px, py);
          }
          if (func === 0x0324) {
            polyPath.closePath();
          }
          paths.push(polyPath);
        }
      }

      offset += recordBytes;
    }

    const page = new PageRecord({
      pageNumber: 1,
      width: widthPts,
      height: heightPts,
      paths,
      metadata: {
        format: 'Windows Metafile (WMF)'
      }
    });

    return new Document({
      title: options.title || 'WMF Vector Graphic',
      creator: 'Poltergeist WMF Ingestion Engine',
      pages: [page],
      colorSpace: ColorSpaceType.RGB
    });
  }

  /**
   * @private
   */
  static _decodeEmf(buffer, options) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const left = view.getInt32(8, true);
    const top = view.getInt32(12, true);
    const right = view.getInt32(16, true);
    const bottom = view.getInt32(20, true);

    const widthPts = Math.max(1, (right - left) * (72.0 / 96.0));
    const heightPts = Math.max(1, (bottom - top) * (72.0 / 96.0));

    const paths = [];
    let curPath = new VectorPath();
    let offset = 0;

    while (offset + 8 <= buffer.length) {
      const recType = view.getUint32(offset, true);
      const recSize = view.getUint32(offset + 4, true);

      if (recSize < 8 || offset + recSize > buffer.length) {
        break;
      }

      if (recType === 0x0000000E) { // EMR_EOF
        break;
      } else if (recType === 0x0000001B) { // EMR_MOVETOEX
        const x = view.getInt32(offset + 8, true) * (72.0 / 96.0);
        const y = view.getInt32(offset + 12, true) * (72.0 / 96.0);
        curPath = new VectorPath();
        curPath.moveTo(x, y);
        paths.push(curPath);
      } else if (recType === 0x00000036) { // EMR_LINETO
        const x = view.getInt32(offset + 8, true) * (72.0 / 96.0);
        const y = view.getInt32(offset + 12, true) * (72.0 / 96.0);
        curPath.lineTo(x, y);
      } else if (recType === 0x0000002B) { // EMR_RECTANGLE
        const l = view.getInt32(offset + 8, true) * (72.0 / 96.0);
        const t = view.getInt32(offset + 12, true) * (72.0 / 96.0);
        const r = view.getInt32(offset + 16, true) * (72.0 / 96.0);
        const b = view.getInt32(offset + 20, true) * (72.0 / 96.0);
        const rp = new VectorPath();
        rp.moveTo(l, t);
        rp.lineTo(r, t);
        rp.lineTo(r, b);
        rp.lineTo(l, b);
        rp.closePath();
        paths.push(rp);
      }

      offset += recSize;
    }

    const page = new PageRecord({
      pageNumber: 1,
      width: widthPts,
      height: heightPts,
      paths,
      metadata: {
        format: 'Enhanced Metafile (EMF)'
      }
    });

    return new Document({
      title: options.title || 'EMF Vector Graphic',
      creator: 'Poltergeist EMF Ingestion Engine',
      pages: [page],
      colorSpace: ColorSpaceType.RGB
    });
  }
}
