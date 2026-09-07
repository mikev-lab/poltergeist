/**
 * @file ai_decoder.js
 * @description Adobe Illustrator (.ai) vector graphic parser for Poltergeist.
 * Ingests modern PDF-compatible Illustrator files (v9.0+) and legacy PostScript/EPS Illustrator files.
 * Strictly zero-dependency and memory-safe.
 */

import { PdfDecoder } from '../pdf/pdf_decoder.js';
import { EpsDecoder } from '../document/postscript/eps_decoder.js';
import { Document } from '../../types/document.js';

export class AiDecoder {
  /**
   * Sniffs whether buffer is an Adobe Illustrator file.
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!buffer || buffer.length < 16) return false;

    // 1. Direct PDF-compatible AI (starts with %PDF-)
    if (PdfDecoder.probe(buffer)) {
      // Check if it has Illustrator markers or is a valid PDF
      return true;
    }

    // 2. Embedded PDF within first 32KB
    const scanLen = Math.min(buffer.length, 32768);
    const text = Buffer.from(buffer.subarray(0, scanLen)).toString('latin1');
    if (text.includes('%PDF-')) {
      return true;
    }

    // 3. Legacy EPS / PostScript Illustrator: starts with %!PS-Adobe or contains Illustrator
    if (EpsDecoder.probe(buffer)) {
      if (text.includes('Illustrator') || text.includes('Adobe Illustrator')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Decodes an Adobe Illustrator buffer into a Document model.
   * @param {Uint8Array} buffer
   * @param {object} [options]
   * @returns {Document}
   */
  static decode(buffer, options = {}) {
    if (!buffer || buffer.length < 16) {
      throw new Error('Buffer too small to be a valid Adobe Illustrator file.');
    }

    // Modern PDF-compatible AI at offset 0
    if (PdfDecoder.probe(buffer)) {
      const doc = PdfDecoder.decode(buffer, options);
      doc.creator = 'Adobe Illustrator (PDF Stream)';
      return doc;
    }

    // Search for embedded %PDF-
    const scanLen = Math.min(buffer.length, 65536);
    const text = Buffer.from(buffer.subarray(0, scanLen)).toString('latin1');
    const pdfIndex = text.indexOf('%PDF-');
    if (pdfIndex > 0) {
      const pdfBytes = buffer.subarray(pdfIndex);
      const doc = PdfDecoder.decode(pdfBytes, options);
      doc.creator = 'Adobe Illustrator (Embedded PDF Stream)';
      return doc;
    }

    // Fallback: Legacy PostScript/EPS Illustrator
    if (EpsDecoder.probe(buffer)) {
      const doc = EpsDecoder.decode(buffer, options);
      doc.creator = 'Adobe Illustrator (PostScript Stream)';
      return doc;
    }

    throw new Error('Unsupported or unrecognized Adobe Illustrator file format.');
  }
}
