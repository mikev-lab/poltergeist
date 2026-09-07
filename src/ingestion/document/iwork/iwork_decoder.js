/**
 * @file iwork_decoder.js
 * @description Apple iWork (.pages, .keynote, .numbers) package reader and page layout extractor.
 * Extracts embedded vector PDF previews or creates 1:1 page layouts.
 * Zero external dependencies.
 */

import { ZipReader } from '../../common/zip_reader.js';
import { PdfDecoder } from '../../pdf/pdf_decoder.js';
import { decodeRaster } from '../../raster/index.js';
import { Document, PageRecord, PageBox } from '../../../types/document.js';

export class IworkDecoder {
  /**
   * Sniffs whether a ZIP package is an Apple iWork document.
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!ZipReader.probe(buffer)) return false;
    try {
      const zip = new ZipReader(buffer);
      const entries = zip.listFiles();
      return entries.some(f => 
        f.startsWith('Index/') || 
        f.startsWith('QuickLook/') || 
        f === 'preview.pdf' || 
        f === 'index.xml' ||
        f.endsWith('.iwa')
      );
    } catch {
      return false;
    }
  }

  /**
   * Decodes an Apple iWork package into a Document.
   * @param {Uint8Array} buffer
   * @param {object} [options]
   * @returns {Document}
   */
  static decode(buffer, options = {}) {
    const zip = new ZipReader(buffer);
    const files = zip.listFiles();

    // 1. Check for embedded PDF preview (highest fidelity, 1:1 vector & fonts)
    const pdfPath = files.find(f => 
      f.toLowerCase() === 'quicklook/preview.pdf' || 
      f.toLowerCase() === 'preview.pdf'
    );

    if (pdfPath) {
      const pdfBytes = zip.readFile(pdfPath);
      const pdfDoc = PdfDecoder.decode(pdfBytes, options);
      pdfDoc.metadata = {
        ...(pdfDoc.metadata || {}),
        sourceFormat: 'iwork',
        container: 'zip'
      };
      return pdfDoc;
    }

    // 2. Check for raster preview
    const rasterPath = files.find(f =>
      f.toLowerCase() === 'quicklook/thumbnail.jpg' ||
      f.toLowerCase() === 'quicklook/thumbnail.png' ||
      f.toLowerCase() === 'thumbnail.jpg' ||
      f.toLowerCase() === 'thumbnail.png'
    );

    if (rasterPath) {
      const rasterBytes = zip.readFile(rasterPath);
      const raster = decodeRaster(rasterBytes);
      const widthPts = (raster.width / (raster.dpiX || 72)) * 72;
      const heightPts = (raster.height / (raster.dpiY || 72)) * 72;

      const doc = new Document({
        title: options.title || 'Apple iWork Document',
        creator: 'Apple iWork'
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
        dpi: raster.dpiX || 300,
        pageBox,
        rasterBackground: raster
      });

      doc.addPage(page);
      return doc;
    }

    // 3. Fallback: Determine document type from file paths (.pages vs .key vs .numbers)
    let format = 'pages';
    let widthPts = 612; // 8.5 x 11 in
    let heightPts = 792;

    if (files.some(f => f.includes('Slide') || f.includes('Keynote'))) {
      format = 'keynote';
      widthPts = 1024; // Standard Keynote 4:3 or 1920x1080 16:9
      heightPts = 768;
    } else if (files.some(f => f.includes('Sheet') || f.includes('Numbers') || f.includes('CalculationEngine'))) {
      format = 'numbers';
      widthPts = 792; // Landscape Letter
      heightPts = 612;
    }

    const doc = new Document({
      title: options.title || `Apple ${format.charAt(0).toUpperCase() + format.slice(1)} Document`,
      creator: 'Apple iWork'
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
      dpi: 300,
      pageBox,
      metadata: { format, files }
    });

    doc.addPage(page);
    return doc;
  }
}
