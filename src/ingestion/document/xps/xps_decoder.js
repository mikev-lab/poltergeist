/**
 * @file xps_decoder.js
 * @description Fixed layout document decoders: OpenXPS / XPS (.xps) and DjVu (.djvu).
 * Zero external dependencies.
 */

import { ZipReader } from '../../common/zip_reader.js';
import { Document, PageRecord, PageBox } from '../../../types/document.js';

const DJVU_MAGIC = new Uint8Array([0x41, 0x54, 0x26, 0x54]); // 'AT&T'

export class XpsDecoder {
  /**
   * Sniffs whether buffer is an XPS or DjVu file.
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!buffer || buffer.length < 8) return false;

    // DjVu check: 'AT&T'
    if (buffer[0] === DJVU_MAGIC[0] &&
        buffer[1] === DJVU_MAGIC[1] &&
        buffer[2] === DJVU_MAGIC[2] &&
        buffer[3] === DJVU_MAGIC[3]) {
      return true;
    }

    // XPS check: ZIP containing .fpage or FixedDocumentSequence
    if (ZipReader.probe(buffer)) {
      try {
        const zip = new ZipReader(buffer);
        const files = zip.listFiles();
        return files.some(f => 
          f.endsWith('.fpage') || 
          f.endsWith('.fdseq') || 
          f.endsWith('.fdoc') || 
          f.includes('FixedDocumentSequence')
        );
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Decodes an XPS or DjVu container into a Document.
   * @param {Uint8Array} buffer
   * @param {object} [options]
   * @returns {Document}
   */
  static decode(buffer, options = {}) {
    if (!XpsDecoder.probe(buffer)) {
      throw new Error('Invalid XPS / DjVu signature');
    }

    // Check DjVu
    if (buffer[0] === DJVU_MAGIC[0] &&
        buffer[1] === DJVU_MAGIC[1] &&
        buffer[2] === DJVU_MAGIC[2] &&
        buffer[3] === DJVU_MAGIC[3]) {
      return XpsDecoder._decodeDjvu(buffer, options);
    }

    // Decode XPS
    return XpsDecoder._decodeXps(buffer, options);
  }

  /**
   * @private
   * @param {Uint8Array} buffer
   * @param {object} options
   * @returns {Document}
   */
  static _decodeDjvu(buffer, options) {
    if (buffer.length < 16) {
      throw new Error(`Truncated DjVu stream: length ${buffer.length} < 16`);
    }

    // Search for 'INFO' chunk
    let width = 612;
    let height = 792;
    let dpi = 300;

    for (let i = 8; i < buffer.length - 12; i++) {
      if (buffer[i] === 0x49 && buffer[i + 1] === 0x4E && buffer[i + 2] === 0x46 && buffer[i + 3] === 0x4F) { // 'INFO'
        // INFO chunk data starts at i + 8 (after 4-byte ID and 4-byte length)
        const offset = i + 8;
        if (offset + 6 <= buffer.length) {
          const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
          width = view.getUint16(offset, false); // Big endian
          height = view.getUint16(offset + 2, false);
          if (offset + 8 <= buffer.length) {
            const rawDpi = view.getUint16(offset + 6, true); // Little endian
            if (rawDpi > 0 && rawDpi <= 2400) {
              dpi = rawDpi;
            }
          }
        }
        break;
      }
    }

    const widthPts = (width / dpi) * 72.0;
    const heightPts = (height / dpi) * 72.0;

    const doc = new Document({
      title: options.title || 'DjVu Document',
      creator: 'DjVu Engine'
    });

    const pageBox = new PageBox({
      mediaBox: [0, 0, widthPts, heightPts],
      trimBox: [0, 0, widthPts, heightPts],
      bleedBox: [0, 0, widthPts, heightPts]
    });

    const page = new PageRecord({
      pageIndex: 0,
      widthPts,
      heightPts,
      dpi,
      pageBox,
      metadata: { format: 'djvu' }
    });

    doc.addPage(page);
    return doc;
  }

  /**
   * @private
   * @param {Uint8Array} buffer
   * @param {object} options
   * @returns {Document}
   */
  static _decodeXps(buffer, options) {
    const zip = new ZipReader(buffer);
    const files = zip.listFiles();

    // Find all .fpage files and sort sequentially
    const fpageFiles = files
      .filter(f => f.endsWith('.fpage'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const doc = new Document({
      title: options.title || 'XPS Document',
      creator: 'OpenXPS Engine'
    });

    if (fpageFiles.length === 0) {
      // Create single default page
      const pageBox = new PageBox({ mediaBox: [0, 0, 612, 792] });
      doc.addPage(new PageRecord({ pageIndex: 0, widthPts: 612, heightPts: 792, dpi: 300, pageBox }));
      return doc;
    }

    for (let i = 0; i < fpageFiles.length; i++) {
      const pageXml = zip.readText(fpageFiles[i]);
      // XPS dimensions: 1/96 inch DIPs -> convert to points (0.75)
      let widthPts = 612;
      let heightPts = 792;

      const wMatch = pageXml.match(/Width="([\d.]+)"/i);
      const hMatch = pageXml.match(/Height="([\d.]+)"/i);

      if (wMatch) {
        widthPts = parseFloat(wMatch[1]) * 0.75;
      }
      if (hMatch) {
        heightPts = parseFloat(hMatch[1]) * 0.75;
      }

      const pageBox = new PageBox({
        mediaBox: [0, 0, widthPts, heightPts],
        trimBox: [0, 0, widthPts, heightPts],
        bleedBox: [0, 0, widthPts, heightPts]
      });

      const page = new PageRecord({
        pageIndex: i,
        widthPts,
        heightPts,
        dpi: 300,
        pageBox,
        metadata: {
          xpsPath: fpageFiles[i]
        }
      });

      doc.addPage(page);
    }

    return doc;
  }
}
