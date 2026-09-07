/**
 * @file ppt_decoder.js
 * @description Microsoft PowerPoint (.pptx) presentation package decoder for Poltergeist.
 * Zero-dependency, memory-safe.
 */

import { ZipReader } from '../../common/zip_reader.js';
import { Document, PageRecord, PageBox } from '../../../types/document.js';
import { ColorSpaceType } from '../../../types/image.js';

export class PptDecoder {
  /**
   * Sniffs whether buffer is a PowerPoint .pptx package.
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!ZipReader.probe(buffer)) return false;
    try {
      const zip = new ZipReader(buffer);
      return zip.has('ppt/presentation.xml') || zip.getFileNames().some(name => name.startsWith('ppt/slides/slide'));
    } catch {
      return false;
    }
  }

  /**
   * Decodes a .pptx binary buffer into a Document.
   * @param {Uint8Array|Buffer} buffer
   * @returns {Document}
   */
  static decode(buffer) {
    const zip = new ZipReader(buffer);

    // Slide Dimensions from ppt/presentation.xml
    // 1 point = 12700 EMUs
    let width = 720;
    let height = 540;

    if (zip.has('ppt/presentation.xml')) {
      const presXml = zip.readText('ppt/presentation.xml');
      const szMatch = presXml.match(/<p:sldSz\b([^>]+)\/>/);
      if (szMatch) {
        const attrs = szMatch[1];
        const cxMatch = attrs.match(/cx="(\d+)"/);
        const cyMatch = attrs.match(/cy="(\d+)"/);
        if (cxMatch) width = parseInt(cxMatch[1], 10) / 12700.0;
        if (cyMatch) height = parseInt(cyMatch[1], 10) / 12700.0;
      }
    }

    const fileNames = zip.getFileNames();
    const slideFiles = fileNames.filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'));
    slideFiles.sort((a, b) => {
      const numA = parseInt(a.replace(/[^0-9]/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/[^0-9]/g, ''), 10) || 0;
      return numA - numB;
    });

    const pages = [];
    let slideCounter = 1;

    for (const slideFile of slideFiles) {
      const slideXml = zip.readText(slideFile);
      const textMatches = slideXml.match(/<a:t\b[^>]*>([^<]+)<\/a:t>/g);
      const text = textMatches ? textMatches.map(m => m.replace(/<[^>]+>/g, '')).join(' ') : '';

      const boxes = new PageBox({
        mediaBox: [0, 0, width, height],
        cropBox: [0, 0, width, height],
        trimBox: [0, 0, width, height]
      });

      pages.push(new PageRecord({
        pageNumber: slideCounter++,
        width,
        height,
        boxes,
        text
      }));
    }

    if (pages.length === 0) {
      pages.push(new PageRecord({ pageNumber: 1, width, height }));
    }

    return new Document({
      title: 'PowerPoint Presentation',
      creator: 'Microsoft PowerPoint OpenXML Ingestion',
      pages,
      colorSpace: ColorSpaceType.RGB
    });
  }
}
