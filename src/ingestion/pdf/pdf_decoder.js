/**
 * @file pdf_decoder.js
 * @description Unified PDF 1.3-2.0 parser and self-healing ingestion engine for Poltergeist.
 * Zero-dependency, memory-safe, drop-in replacement for Ghostscript pdfwrite input.
 */

import { Document } from '../../types/document.js';
import { ColorSpaceType } from '../../types/image.js';
import { PdfXrefParser } from './xref.js';
import { PdfRepair } from './repair.js';
import { PageTreeTraverser } from './page_tree.js';

export class PdfDecoder {
  /**
   * Sniffs whether buffer starts with %PDF-
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!buffer || buffer.length < 5) return false;
    return (
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46 &&
      buffer[4] === 0x2D
    );
  }

  /**
   * Decodes a raw PDF buffer into a Document model with self-healing xref recovery.
   * 
   * @param {Uint8Array|Buffer} buffer
   * @param {object} [options]
   * @returns {Document}
   */
  static decode(buffer, options = {}) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 8) {
      throw new Error('Buffer too small to be a valid PDF file.');
    }

    const header = String.fromCharCode(...bytes.subarray(0, 5));
    if (header !== '%PDF-') {
      throw new Error(`Invalid PDF magic header: expected '%PDF-', got '${header}'`);
    }

    let xref;
    try {
      const parser = new PdfXrefParser(bytes);
      xref = parser.parse();
    } catch (err) {
      // Self-Healing Recovery: Reconstruct corrupted xref and trailer
      xref = PdfRepair.repair(bytes);
    }

    const traverser = new PageTreeTraverser(bytes, xref, options);
    const pages = traverser.traversePages();

    let title = 'Document';
    const infoRef = xref.trailer.get('Info');
    if (infoRef) {
      const info = traverser.resolve(infoRef);
      if (info instanceof Map && info.has('Title')) {
        title = info.get('Title');
      }
    }

    return new Document({
      title,
      creator: 'Poltergeist PDF Ingestion Engine',
      pages,
      colorSpace: ColorSpaceType.RGB
    });
  }
}
