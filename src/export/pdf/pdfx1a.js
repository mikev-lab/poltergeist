/**
 * @file pdfx1a.js
 * @description PDF/X-1a:2001 (ISO 15930-1) compliant prepress PDF generator for Poltergeist.
 * Strictly zero-dependency, DeviceCMYK only, OutputIntents embedded, zero live transparency.
 */

import { PdfWriter } from './writer.js';
import {
  PdfDictionary,
  PdfArray,
  PdfName,
  PdfString,
  PdfStream
} from './objects.js';
import { ColorSpaceType, RasterImage } from '../../types/image.js';
import { Document, PageRecord } from '../../types/document.js';
import { IccProfile } from '../../color/icc/profile.js';

export class PdfX1aGenerator {
  /**
   * Generates a valid PDF/X-1a:2001 file from a CMYK RasterImage, Document, or PageRecord array.
   * @param {import('../../types/image.js').RasterImage | import('../../types/document.js').Document | import('../../types/document.js').PageRecord[]} input
   * @param {object} [options]
   * @param {string} [options.title='Poltergeist Prepress Export']
   * @param {string} [options.outputCondition='CGATS TR 001']
   * @param {string} [options.outputConditionIdentifier='CGATS TR 001']
   * @param {number} [options.bleedPts=9] Bleed in points (default 9 pts = 1/8 inch)
   * @returns {Uint8Array}
   */
  static generate(input, options = {}) {
    const title = options.title || 'Poltergeist Prepress Export';
    const condition = options.outputCondition || 'CGATS TR 001';
    const conditionId = options.outputConditionIdentifier || 'CGATS TR 001';
    const bleedPts = options.bleedPts !== undefined ? options.bleedPts : 9;

    // Normalize input to array of PageRecords
    let pages = [];
    let primaryIcc = null;

    if (input instanceof Document) {
      pages = input.pages;
    } else if (Array.isArray(input)) {
      pages = input;
    } else if (input instanceof RasterImage) {
      if (input.colorSpace !== ColorSpaceType.CMYK) {
        throw new TypeError(`PDF/X-1a requires DeviceCMYK color space. Encountered: ${input.colorSpace}`);
      }
      primaryIcc = input.iccProfile;
      const ptsW = (input.width / input.dpiX) * 72.0;
      const ptsH = (input.height / input.dpiY) * 72.0;
      pages = [
        new PageRecord({
          pageIndex: 0,
          widthPts: ptsW,
          heightPts: ptsH,
          dpi: input.dpiX,
          rasterBackground: input
        })
      ];
    } else {
      throw new TypeError('Unsupported input type for PDF/X-1a generation');
    }

    if (pages.length === 0) {
      throw new Error('Cannot generate PDF/X-1a document with zero pages');
    }

    const writer = new PdfWriter('1.3'); // PDF/X-1a:2001 is based on PDF 1.3

    // 1. OutputIntent ICC Profile Stream
    let iccBytes;
    if (primaryIcc && primaryIcc.buffer) {
      iccBytes = primaryIcc.buffer;
    } else {
      iccBytes = IccProfile.createCmykReferenceProfile().toBuffer();
    }

    const iccStreamDict = new PdfDictionary();
    iccStreamDict.set('N', 4);
    const iccStream = new PdfStream(iccStreamDict, iccBytes, true);
    const iccRef = writer.addObject(iccStream);

    // 2. OutputIntent Dictionary (/GTS_PDFX)
    const outputIntentDict = new PdfDictionary();
    outputIntentDict.set('Type', new PdfName('OutputIntent'));
    outputIntentDict.set('S', new PdfName('GTS_PDFX'));
    outputIntentDict.set('OutputCondition', new PdfString(condition));
    outputIntentDict.set('OutputConditionIdentifier', new PdfString(conditionId));
    outputIntentDict.set('RegistryName', new PdfString('http://www.color.org'));
    outputIntentDict.set('DestOutputProfile', iccRef);
    const outputIntentRef = writer.addObject(outputIntentDict);

    // Pages container dictionary forward reference
    const pagesDict = new PdfDictionary();
    pagesDict.set('Type', new PdfName('Pages'));
    const pagesRef = writer.addObject(pagesDict);

    const pageRefs = [];

    // 3. Build Pages
    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const page = pages[pIdx];
      const widthPts = page.widthPts;
      const heightPts = page.heightPts;

      let mediaBox;
      let bleedBox;
      let trimBox;

      if (page.pageBox) {
        mediaBox = new PdfArray(page.pageBox.mediaBox);
        bleedBox = new PdfArray(page.pageBox.bleedBox);
        trimBox = new PdfArray(page.pageBox.trimBox);
      } else {
        mediaBox = new PdfArray([0, 0, widthPts + bleedPts * 2, heightPts + bleedPts * 2]);
        bleedBox = new PdfArray([0, 0, widthPts + bleedPts * 2, heightPts + bleedPts * 2]);
        trimBox = new PdfArray([bleedPts, bleedPts, widthPts + bleedPts, heightPts + bleedPts]);
      }

      const resourcesDict = new PdfDictionary();
      resourcesDict.set('ProcSet', new PdfArray([new PdfName('PDF'), new PdfName('ImageC')]));

      const contentLines = [];

      // Raster background
      if (page.rasterBackground) {
        const img = page.rasterBackground;
        if (img.colorSpace !== ColorSpaceType.CMYK) {
          throw new TypeError(`PDF/X-1a requires DeviceCMYK color space. Page ${pIdx} has: ${img.colorSpace}`);
        }

        const imageDict = new PdfDictionary();
        imageDict.set('Type', new PdfName('XObject'));
        imageDict.set('Subtype', new PdfName('Image'));
        imageDict.set('Width', img.width);
        imageDict.set('Height', img.height);
        imageDict.set('ColorSpace', new PdfName('DeviceCMYK'));
        imageDict.set('BitsPerComponent', 8);

        const imageStream = new PdfStream(imageDict, img.data, true);
        const imageRef = writer.addObject(imageStream);

        const xObjectDict = new PdfDictionary();
        const imgName = `Im${pIdx + 1}`;
        xObjectDict.set(imgName, imageRef);
        resourcesDict.set('XObject', xObjectDict);

        const drawX = page.pageBox ? page.pageBox.trimBox[0] : bleedPts;
        const drawY = page.pageBox ? page.pageBox.trimBox[1] : bleedPts;

        contentLines.push(
          'q',
          `${widthPts.toFixed(4)} 0 0 ${heightPts.toFixed(4)} ${drawX.toFixed(4)} ${drawY.toFixed(4)} cm`,
          `/${imgName} Do`,
          'Q'
        );
      }

      // Vector paths
      if (page.paths && page.paths.length > 0) {
        contentLines.push('q', '0 0 0 1 K', '0 0 0 1 k', '1 w'); // 100% K stroke/fill
        for (const p of page.paths) {
          const pdfOps = typeof p.toPdfPathData === 'function' ? p.toPdfPathData() : '';
          if (pdfOps) {
            contentLines.push(pdfOps, 'S');
          }
        }
        contentLines.push('Q');
      }

      if (contentLines.length === 0) {
        // Minimal valid content stream
        contentLines.push('q Q');
      }

      const contentBytes = Buffer.from(contentLines.join('\n') + '\n', 'latin1');
      const contentStream = new PdfStream(new PdfDictionary(), contentBytes, true);
      const contentRef = writer.addObject(contentStream);

      const pageDict = new PdfDictionary();
      pageDict.set('Type', new PdfName('Page'));
      pageDict.set('Parent', pagesRef);
      pageDict.set('MediaBox', mediaBox);
      pageDict.set('BleedBox', bleedBox);
      pageDict.set('TrimBox', trimBox);
      pageDict.set('Contents', contentRef);
      pageDict.set('Resources', resourcesDict);

      const pageRef = writer.addObject(pageDict);
      pageRefs.push(pageRef);
    }

    pagesDict.set('Kids', new PdfArray(pageRefs));
    pagesDict.set('Count', pageRefs.length);

    // Document Catalog (/Root)
    const catalogDict = new PdfDictionary();
    catalogDict.set('Type', new PdfName('Catalog'));
    catalogDict.set('Pages', pagesRef);
    catalogDict.set('OutputIntents', new PdfArray([outputIntentRef]));
    const rootRef = writer.addObject(catalogDict);
    writer.rootRef = rootRef;

    // Document Info Dictionary (/Info)
    const infoDict = new PdfDictionary();
    infoDict.set('Title', new PdfString(title));
    infoDict.set('Creator', new PdfString('Poltergeist Prepress Engine'));
    infoDict.set('GTS_PDFXVersion', new PdfString('PDF/X-1a:2001'));
    infoDict.set('CreationDate', new PdfString('D:20260101000000Z'));
    const infoRef = writer.addObject(infoDict);
    writer.infoRef = infoRef;

    return writer.compile();
  }
}

