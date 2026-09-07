/**
 * @file legacy_office.js
 * @description Pure binary Compound File Binary Format (CFBF / OLE 2) parser and sniffer.
 * Ingests legacy Microsoft Office documents (.doc, .xls, .ppt, .pub, .vsd).
 * Zero external dependencies, memory-safe bounds verification.
 */

import { Document, PageRecord, PageBox } from '../../../types/document.js';

const OLE2_MAGIC = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

export class LegacyOfficeDecoder {
  /**
   * Sniffs whether buffer has OLE2 / CFBF magic header.
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!buffer || buffer.length < 8) return false;
    for (let i = 0; i < 8; i++) {
      if (buffer[i] !== OLE2_MAGIC[i]) return false;
    }
    return true;
  }

  /**
   * Decodes a legacy Office CFBF container into a Document instance.
   * @param {Uint8Array} buffer
   * @param {object} [options]
   * @returns {Document}
   */
  static decode(buffer, options = {}) {
    if (!LegacyOfficeDecoder.probe(buffer)) {
      throw new Error(`Invalid CFBF magic header: expected [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] at offset 0`);
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (buffer.length < 512) {
      throw new Error(`Truncated CFBF header: buffer length ${buffer.length} < 512`);
    }

    const sectorShift = view.getUint16(30, true);
    if (sectorShift < 7 || sectorShift > 16) {
      throw new Error(`Invalid CFBF sector shift: ${sectorShift}`);
    }
    const sectorSize = 1 << sectorShift;

    // Directory first sector
    const dirFirstSector = view.getUint32(48, true);

    // Read directory entries (128 bytes each)
    const streamNames = [];
    if (dirFirstSector !== 0xFFFFFFFE && dirFirstSector !== 0xFFFFFFFF) {
      const dirOffset = (dirFirstSector + 1) * sectorSize;
      if (dirOffset + 128 <= buffer.length) {
        const numEntries = Math.min(64, Math.floor((buffer.length - dirOffset) / 128));
        for (let i = 0; i < numEntries; i++) {
          const entryOffset = dirOffset + i * 128;
          const nameLen = view.getUint16(entryOffset + 64, true);
          if (nameLen > 2 && nameLen <= 64) {
            let name = '';
            for (let c = 0; c < nameLen - 2; c += 2) {
              const code = view.getUint16(entryOffset + c, true);
              if (code !== 0) name += String.fromCharCode(code);
            }
            if (name.length > 0) {
              streamNames.push(name);
            }
          }
        }
      }
    }

    // Determine subtype
    let format = 'legacy-office';
    let defaultWidth = 612; // 8.5"
    let defaultHeight = 792; // 11"
    let defaultDpi = 300;

    if (streamNames.some(n => n.includes('WordDocument'))) {
      format = 'doc';
    } else if (streamNames.some(n => n.includes('Workbook') || n.includes('Book'))) {
      format = 'xls';
    } else if (streamNames.some(n => n.includes('PowerPoint') || n.includes('Current User'))) {
      format = 'ppt';
      defaultWidth = 720; // 10" x 7.5" standard 4:3 slide
      defaultHeight = 540;
    } else if (streamNames.some(n => n.includes('VisioDocument') || n.includes('Visio'))) {
      format = 'vsd';
    } else if (streamNames.some(n => n.includes('Escher'))) {
      format = 'pub';
    }

    const doc = new Document({
      title: options.title || `Legacy Office (${format.toUpperCase()})`,
      creator: 'Poltergeist Prepress Engine'
    });

    // Default Page
    const pageBox = new PageBox({
      mediaBox: [0, 0, defaultWidth, defaultHeight],
      trimBox: [0, 0, defaultWidth, defaultHeight],
      bleedBox: [0, 0, defaultWidth, defaultHeight]
    });

    const page = new PageRecord({
      pageIndex: 0,
      widthPts: defaultWidth,
      heightPts: defaultHeight,
      dpi: defaultDpi,
      pageBox,
      metadata: {
        format,
        streams: streamNames
      }
    });

    doc.addPage(page);
    return doc;
  }
}
