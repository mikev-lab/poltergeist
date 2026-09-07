/**
 * @file pdf_decoder.js
 * @description Unified PDF 1.3-2.0 parser and self-healing ingestion engine for Poltergeist.
 * Zero-dependency, memory-safe, drop-in replacement for Ghostscript pdfwrite input.
 */

import fs from 'node:fs';
import { Document } from '../../types/document.js';
import { ColorSpaceType } from '../../types/image.js';
import { SeekableSource, createSeekableBytes } from '../../io/seekable.js';
import { FileSeekableSource } from '../../io/file_seekable.js';
import { PdfXrefParser } from './xref.js';
import { PdfRepair } from './repair.js';
import { PageTreeTraverser } from './page_tree.js';

export class PdfDecoder {
  /**
   * Sniffs whether buffer or file starts with %PDF-
   * @param {Uint8Array|SeekableSource|string} input
   * @returns {boolean}
   */
  static probe(input) {
    if (!input) return false;
    if (typeof input === 'string') {
      try {
        if (!fs.existsSync(input)) return false;
        const fd = fs.openSync(input, 'r');
        const buf = Buffer.alloc(5);
        const bytesRead = fs.readSync(fd, buf, 0, 5, 0);
        fs.closeSync(fd);
        if (bytesRead < 5) return false;
        return buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2D;
      } catch {
        return false;
      }
    }
    if (input instanceof SeekableSource) {
      if (input.size < 5) return false;
      const b = input.readSync(0, 5);
      return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2D;
    }
    if (input.length < 5) return false;
    return (
      input[0] === 0x25 &&
      input[1] === 0x50 &&
      input[2] === 0x44 &&
      input[3] === 0x46 &&
      input[4] === 0x2D
    );
  }

  /**
   * Decodes a raw PDF buffer, SeekableSource, or file path into a Document model with self-healing xref recovery.
   * 
   * @param {Uint8Array|Buffer|SeekableSource|string} input
   * @param {object} [options]
   * @returns {Document}
   */
  static decode(input, options = {}) {
    let source = null;
    if (typeof input === 'string') {
      source = new FileSeekableSource(input);
    } else if (input instanceof SeekableSource) {
      source = input;
    }

    const bytes = source ? createSeekableBytes(source) : (input instanceof Uint8Array ? input : new Uint8Array(input));
    if (bytes.length < 8) {
      if (source) source.close();
      throw new Error('Buffer too small to be a valid PDF file.');
    }

    const header = String.fromCharCode(...bytes.subarray(0, 5));
    if (header !== '%PDF-') {
      if (source) source.close();
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
