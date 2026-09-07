/**
 * @file odf_decoder.js
 * @description OpenDocument format (.odt, .ods, .odp, .odg) package reader and page layout extractor.
 * Zero external dependencies.
 */

import { ZipReader } from '../../common/zip_reader.js';
import { Document, PageRecord, PageBox } from '../../../types/document.js';

export class OdfDecoder {
  /**
   * Sniffs whether buffer is an OpenDocument package.
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!ZipReader.probe(buffer)) return false;
    try {
      const zip = new ZipReader(buffer);
      if (zip.hasFile('mimetype')) {
        const mime = zip.readText('mimetype').trim();
        return mime.startsWith('application/vnd.oasis.opendocument');
      }
      return zip.hasFile('content.xml') && zip.hasFile('styles.xml');
    } catch {
      return false;
    }
  }

  /**
   * Parses length strings with units (in, cm, mm, pt, px) into points (1/72 inch).
   * @param {string} val
   * @param {number} [defaultValue=612]
   * @returns {number}
   */
  static parseLengthToPts(val, defaultValue = 612) {
    if (!val) return defaultValue;
    const match = String(val).trim().match(/^([\d.]+)\s*(in|cm|mm|pt|px)?$/i);
    if (!match) return defaultValue;
    const num = parseFloat(match[1]);
    const unit = (match[2] || 'pt').toLowerCase();

    switch (unit) {
      case 'in': return num * 72.0;
      case 'cm': return num * (72.0 / 2.54);
      case 'mm': return num * (72.0 / 25.4);
      case 'pt': return num;
      case 'px': return num * (72.0 / 96.0);
      default: return num;
    }
  }

  /**
   * Decodes an ODF package into a Document.
   * @param {Uint8Array} buffer
   * @param {object} [options]
   * @returns {Document}
   */
  static decode(buffer, options = {}) {
    const zip = new ZipReader(buffer);
    let mime = '';
    if (zip.hasFile('mimetype')) {
      mime = zip.readText('mimetype').trim();
    }

    let defaultWidth = 612; // 8.5"
    let defaultHeight = 792; // 11"
    let margins = { top: 54, right: 54, bottom: 54, left: 54 };

    // Inspect styles.xml for page dimensions
    if (zip.hasFile('styles.xml')) {
      const stylesXml = zip.readText('styles.xml');
      const wMatch = stylesXml.match(/fo:page-width="([^"]+)"/);
      const hMatch = stylesXml.match(/fo:page-height="([^"]+)"/);
      const mTopMatch = stylesXml.match(/fo:margin-top="([^"]+)"/);
      const mBottomMatch = stylesXml.match(/fo:margin-bottom="([^"]+)"/);
      const mLeftMatch = stylesXml.match(/fo:margin-left="([^"]+)"/);
      const mRightMatch = stylesXml.match(/fo:margin-right="([^"]+)"/);

      if (wMatch) defaultWidth = OdfDecoder.parseLengthToPts(wMatch[1], defaultWidth);
      if (hMatch) defaultHeight = OdfDecoder.parseLengthToPts(hMatch[1], defaultHeight);
      if (mTopMatch) margins.top = OdfDecoder.parseLengthToPts(mTopMatch[1], 54);
      if (mBottomMatch) margins.bottom = OdfDecoder.parseLengthToPts(mBottomMatch[1], 54);
      if (mLeftMatch) margins.left = OdfDecoder.parseLengthToPts(mLeftMatch[1], 54);
      if (mRightMatch) margins.right = OdfDecoder.parseLengthToPts(mRightMatch[1], 54);
    }

    const doc = new Document({
      title: options.title || 'OpenDocument',
      creator: 'Poltergeist Prepress Engine',
      metadata: { mime }
    });

    const isPresentation = mime.includes('presentation');
    let pageCount = 1;

    if (zip.hasFile('content.xml')) {
      const contentXml = zip.readText('content.xml');
      if (isPresentation) {
        // Count <draw:page> elements
        const drawPages = contentXml.match(/<draw:page\b/g);
        if (drawPages && drawPages.length > 0) {
          pageCount = drawPages.length;
        }
      } else {
        // Check for manual page breaks or soft page breaks
        const breaks = contentXml.match(/<text:soft-page-break\b/g);
        if (breaks && breaks.length > 0) {
          pageCount = breaks.length + 1;
        }
      }
    }

    for (let i = 0; i < pageCount; i++) {
      const pageBox = new PageBox({
        mediaBox: [0, 0, defaultWidth, defaultHeight],
        trimBox: [margins.left, margins.bottom, defaultWidth - margins.right, defaultHeight - margins.top],
        bleedBox: [0, 0, defaultWidth, defaultHeight]
      });

      const page = new PageRecord({
        pageIndex: i,
        widthPts: defaultWidth,
        heightPts: defaultHeight,
        dpi: 300,
        pageBox,
        metadata: {
          mime,
          pageNumber: i + 1
        }
      });

      doc.addPage(page);
    }

    return doc;
  }
}
