/**
 * @file eps_decoder.js
 * @description Encapsulated PostScript (EPS) and PostScript (PS) DSC parser.
 * Handles DOS EPS binary wrappers and ASCII/DSC streams.
 * Zero external dependencies.
 */

import { Document, PageRecord, PageBox } from '../../../types/document.js';
import { decodeRaster } from '../../raster/index.js';

const DOS_EPS_MAGIC = new Uint8Array([0xC5, 0xD0, 0xD3, 0xC6]);

export class EpsDecoder {
  /**
   * Sniffs whether buffer is an EPS or PostScript stream.
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!buffer || buffer.length < 4) return false;
    // DOS EPS binary header
    if (buffer[0] === DOS_EPS_MAGIC[0] &&
        buffer[1] === DOS_EPS_MAGIC[1] &&
        buffer[2] === DOS_EPS_MAGIC[2] &&
        buffer[3] === DOS_EPS_MAGIC[3]) {
      return true;
    }
    // ASCII PostScript header: %!
    if (buffer[0] === 0x25 && buffer[1] === 0x21) {
      return true;
    }
    // Ctrl-D prefix (\x04%!)
    if (buffer[0] === 0x04 && buffer[1] === 0x25 && buffer[2] === 0x21) {
      return true;
    }
    return false;
  }

  /**
   * Decodes an EPS / PS buffer into a Document.
   * @param {Uint8Array} buffer
   * @param {object} [options]
   * @returns {Document}
   */
  static decode(buffer, options = {}) {
    if (!EpsDecoder.probe(buffer)) {
      throw new Error(`Invalid PostScript/EPS header signature at offset 0`);
    }

    let psBytes = buffer;
    let tiffPreviewBytes = null;

    // Check DOS EPS header
    if (buffer[0] === DOS_EPS_MAGIC[0] &&
        buffer[1] === DOS_EPS_MAGIC[1] &&
        buffer[2] === DOS_EPS_MAGIC[2] &&
        buffer[3] === DOS_EPS_MAGIC[3]) {
      if (buffer.length < 30) {
        throw new Error(`Truncated DOS EPS header: ${buffer.length} < 30`);
      }
      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const psOffset = view.getUint32(4, true);
      const psLength = view.getUint32(8, true);
      const tiffOffset = view.getUint32(20, true);
      const tiffLength = view.getUint32(24, true);

      if (psOffset + psLength <= buffer.length) {
        psBytes = buffer.subarray(psOffset, psOffset + psLength);
      }
      if (tiffOffset > 0 && tiffLength > 0 && tiffOffset + tiffLength <= buffer.length) {
        tiffPreviewBytes = buffer.subarray(tiffOffset, tiffOffset + tiffLength);
      }
    }

    // Read DSC text (search up to first 64KB for DSC comments)
    const scanLen = Math.min(psBytes.length, 65536);
    const headerStr = Buffer.from(psBytes.subarray(0, scanLen)).toString('latin1');

    // Parse BoundingBox: %%BoundingBox: llx lly urx ury
    let llx = 0, lly = 0, urx = 612, ury = 792;
    const bboxMatch = headerStr.match(/%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i);
    const hiresMatch = headerStr.match(/%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i);

    if (hiresMatch) {
      llx = parseFloat(hiresMatch[1]);
      lly = parseFloat(hiresMatch[2]);
      urx = parseFloat(hiresMatch[3]);
      ury = parseFloat(hiresMatch[4]);
    } else if (bboxMatch && bboxMatch[1] !== '(atend)') {
      llx = parseFloat(bboxMatch[1]);
      lly = parseFloat(bboxMatch[2]);
      urx = parseFloat(bboxMatch[3]);
      ury = parseFloat(bboxMatch[4]);
    }

    const widthPts = Math.max(1, urx - llx);
    const heightPts = Math.max(1, ury - lly);

    // Title / Creator
    const titleMatch = headerStr.match(/%%Title:\s*(.+)/i);
    const creatorMatch = headerStr.match(/%%Creator:\s*(.+)/i);
    const title = titleMatch ? titleMatch[1].trim() : (options.title || 'PostScript Document');
    const creator = creatorMatch ? creatorMatch[1].trim() : 'PostScript Engine';

    // Page count
    const pagesMatch = headerStr.match(/%%Pages:\s*(\d+)/i);
    const numPages = pagesMatch ? Math.max(1, parseInt(pagesMatch[1], 10)) : 1;

    let rasterPreview = null;
    if (tiffPreviewBytes) {
      try {
        rasterPreview = decodeRaster(tiffPreviewBytes);
      } catch {
        // Ignored, proceed with vector bounding box
      }
    }

    const doc = new Document({ title, creator });

    for (let i = 0; i < numPages; i++) {
      const pageBox = new PageBox({
        mediaBox: [llx, lly, urx, ury],
        trimBox: [llx, lly, urx, ury],
        bleedBox: [llx, lly, urx, ury]
      });

      const page = new PageRecord({
        pageIndex: i,
        widthPts,
        heightPts,
        dpi: 300,
        pageBox,
        rasterBackground: i === 0 ? rasterPreview : null,
        metadata: {
          isEps: true,
          psData: psBytes
        }
      });

      doc.addPage(page);
    }

    return doc;
  }
}
