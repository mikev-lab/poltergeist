/**
 * @file excel_decoder.js
 * @description Microsoft Excel (.xlsx) workbook package decoder for Poltergeist.
 * Zero-dependency, memory-safe.
 */

import { ZipReader } from '../../common/zip_reader.js';
import { Document, PageRecord, PageBox } from '../../../types/document.js';
import { ColorSpaceType } from '../../../types/image.js';

export class ExcelDecoder {
  /**
   * Sniffs whether buffer is an Excel .xlsx package.
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!ZipReader.probe(buffer)) return false;
    try {
      const zip = new ZipReader(buffer);
      return zip.has('xl/workbook.xml') || zip.getFileNames().some(name => name.startsWith('xl/worksheets/sheet'));
    } catch {
      return false;
    }
  }

  /**
   * Decodes a .xlsx binary buffer into a Document.
   * @param {Uint8Array|Buffer} buffer
   * @returns {Document}
   */
  static decode(buffer) {
    const zip = new ZipReader(buffer);
    const fileNames = zip.getFileNames();

    const sheetFiles = fileNames.filter(name => name.startsWith('xl/worksheets/sheet') && name.endsWith('.xml'));
    sheetFiles.sort();

    const pages = [];
    let pageNum = 1;

    for (const sheetFile of sheetFiles) {
      const xml = zip.readText(sheetFile);

      // Default Letter landscape for spreadsheets
      let width = 792;
      let height = 612;

      const setupMatch = xml.match(/<pageSetup\b([^>]+)\/>/);
      if (setupMatch) {
        const attrs = setupMatch[1];
        if (attrs.includes('orientation="portrait"')) {
          width = 612;
          height = 792;
        }
      }

      // Extract cell values
      const cellMatches = xml.match(/<v>([^<]+)<\/v>/g);
      const text = cellMatches ? cellMatches.map(m => m.replace(/<[^>]+>/g, '')).join('\t') : '';

      const boxes = new PageBox({
        mediaBox: [0, 0, width, height],
        cropBox: [0, 0, width, height],
        trimBox: [0, 0, width, height]
      });

      pages.push(new PageRecord({
        pageNumber: pageNum++,
        width,
        height,
        boxes,
        text
      }));
    }

    if (pages.length === 0) {
      pages.push(new PageRecord({ pageNumber: 1, width: 792, height: 612 }));
    }

    return new Document({
      title: 'Excel Workbook',
      creator: 'Microsoft Excel OpenXML Ingestion',
      pages,
      colorSpace: ColorSpaceType.RGB
    });
  }
}
