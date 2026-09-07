/**
 * @file word_decoder.js
 * @description Microsoft Word (.docx) document package decoder for Poltergeist.
 * Zero-dependency, memory-safe.
 */

import { ZipReader } from '../../common/zip_reader.js';
import { Document, PageRecord, PageBox } from '../../../types/document.js';
import { ColorSpaceType } from '../../../types/image.js';

export class WordDecoder {
  /**
   * Sniffs whether buffer is a Word .docx package.
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!ZipReader.probe(buffer)) return false;
    try {
      const zip = new ZipReader(buffer);
      return zip.has('word/document.xml');
    } catch {
      return false;
    }
  }

  /**
   * Decodes a .docx binary buffer into a Document.
   * @param {Uint8Array|Buffer} buffer
   * @returns {Document}
   */
  static decode(buffer) {
    const zip = new ZipReader(buffer);
    if (!zip.has('word/document.xml')) {
      throw new Error('Invalid Word document: word/document.xml not found in package.');
    }

    const docXml = zip.readText('word/document.xml');

    // Extract Page Size from Section Properties: <w:pgSz w:w="12240" w:h="15840" />
    // 20 dxa = 1 point
    let width = 612;
    let height = 792;

    const szMatch = docXml.match(/<w:pgSz\b([^>]+)\/>/);
    if (szMatch) {
      const attrs = szMatch[1];
      const wMatch = attrs.match(/w:w="(\d+)"/);
      const hMatch = attrs.match(/w:h="(\d+)"/);
      const orientMatch = attrs.match(/w:orient="([a-zA-Z]+)"/);

      if (wMatch) width = parseInt(wMatch[1], 10) / 20.0;
      if (hMatch) height = parseInt(hMatch[1], 10) / 20.0;

      if (orientMatch && orientMatch[1] === 'landscape' && width < height) {
        const temp = width;
        width = height;
        height = temp;
      }
    }

    // Extract Margins: <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    let mTop = 0;
    let mBottom = 0;
    let mLeft = 0;
    let mRight = 0;

    const marMatch = docXml.match(/<w:pgMar\b([^>]+)\/>/);
    if (marMatch) {
      const mAttrs = marMatch[1];
      const t = mAttrs.match(/w:top="(\d+)"/);
      const b = mAttrs.match(/w:bottom="(\d+)"/);
      const l = mAttrs.match(/w:left="(\d+)"/);
      const r = mAttrs.match(/w:right="(\d+)"/);
      if (t) mTop = parseInt(t[1], 10) / 20.0;
      if (b) mBottom = parseInt(b[1], 10) / 20.0;
      if (l) mLeft = parseInt(l[1], 10) / 20.0;
      if (r) mRight = parseInt(r[1], 10) / 20.0;
    }

    // Extract text content from <w:t>
    const textMatches = docXml.match(/<w:t\b[^>]*>([^<]+)<\/w:t>/g);
    let fullText = '';
    if (textMatches) {
      fullText = textMatches.map(m => m.replace(/<[^>]+>/g, '')).join(' ');
    }

    // Split pages by manual page breaks: <w:br w:type="page"/>
    const pageChunks = docXml.split(/<w:br\s+w:type="page"\s*\/>/);
    const pages = [];

    for (let i = 0; i < pageChunks.length; i++) {
      const chunkText = (pageChunks[i].match(/<w:t\b[^>]*>([^<]+)<\/w:t>/g) || [])
        .map(m => m.replace(/<[^>]+>/g, ''))
        .join(' ');

      const trimBox = (mLeft > 0 || mRight > 0 || mTop > 0 || mBottom > 0)
        ? [mLeft, mBottom, width - mRight, height - mTop]
        : [0, 0, width, height];

      const boxes = new PageBox({
        mediaBox: [0, 0, width, height],
        cropBox: [0, 0, width, height],
        bleedBox: [0, 0, width, height],
        trimBox
      });

      pages.push(new PageRecord({
        pageNumber: i + 1,
        width,
        height,
        boxes,
        text: chunkText || fullText
      }));
    }

    return new Document({
      title: 'Word Document',
      creator: 'Microsoft Word OpenXML Ingestion',
      pages,
      colorSpace: ColorSpaceType.RGB
    });
  }
}
