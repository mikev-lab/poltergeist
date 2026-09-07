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
import { ColorSpaceType } from '../../types/image.js';
import { IccProfile } from '../../color/icc/profile.js';

export class PdfX1aGenerator {
  /**
   * Generates a valid PDF/X-1a:2001 file from a CMYK RasterImage.
   * @param {import('../../types/image.js').RasterImage} image Must be CMYK
   * @param {object} [options]
   * @param {string} [options.title='Poltergeist Prepress Export']
   * @param {string} [options.outputCondition='CGATS TR 001']
   * @param {string} [options.outputConditionIdentifier='CGATS TR 001']
   * @param {number} [options.bleedPts=9] Bleed in points (default 9 pts = 1/8 inch)
   * @returns {Uint8Array}
   */
  static generate(image, options = {}) {
    if (image.colorSpace !== ColorSpaceType.CMYK) {
      throw new TypeError(`PDF/X-1a requires DeviceCMYK color space. Encountered: ${image.colorSpace}`);
    }

    const title = options.title || 'Poltergeist Prepress Export';
    const condition = options.outputCondition || 'CGATS TR 001';
    const conditionId = options.outputConditionIdentifier || 'CGATS TR 001';
    const bleedPts = options.bleedPts !== undefined ? options.bleedPts : 9;

    const writer = new PdfWriter('1.3'); // PDF/X-1a:2001 is based on PDF 1.3

    // Dimensions in PDF Points (1/72 inch)
    const ptsWidth = (image.width / image.dpiX) * 72.0;
    const ptsHeight = (image.height / image.dpiY) * 72.0;

    const mediaBox = new PdfArray([0, 0, ptsWidth + bleedPts * 2, ptsHeight + bleedPts * 2]);
    const bleedBox = new PdfArray([0, 0, ptsWidth + bleedPts * 2, ptsHeight + bleedPts * 2]);
    const trimBox = new PdfArray([bleedPts, bleedPts, ptsWidth + bleedPts, ptsHeight + bleedPts]);

    // 1. OutputIntent ICC Profile Stream
    let iccBytes;
    if (image.iccProfile && image.iccProfile.buffer) {
      iccBytes = image.iccProfile.buffer;
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

    // 3. Image XObject
    const imageDict = new PdfDictionary();
    imageDict.set('Type', new PdfName('XObject'));
    imageDict.set('Subtype', new PdfName('Image'));
    imageDict.set('Width', image.width);
    imageDict.set('Height', image.height);
    imageDict.set('ColorSpace', new PdfName('DeviceCMYK'));
    imageDict.set('BitsPerComponent', 8);

    const imageStream = new PdfStream(imageDict, image.data, true);
    const imageRef = writer.addObject(imageStream);

    // 4. Page Content Stream
    const contentCode = [
      'q',
      `${ptsWidth.toFixed(4)} 0 0 ${ptsHeight.toFixed(4)} ${bleedPts.toFixed(4)} ${bleedPts.toFixed(4)} cm`,
      '/Im1 Do',
      'Q\n'
    ].join('\n');

    const contentBytes = Buffer.from(contentCode, 'latin1');
    const contentStream = new PdfStream(new PdfDictionary(), contentBytes, true);
    const contentRef = writer.addObject(contentStream);

    // 5. Page Resources Dictionary
    const xObjectDict = new PdfDictionary();
    xObjectDict.set('Im1', imageRef);

    const resourcesDict = new PdfDictionary();
    resourcesDict.set('ProcSet', new PdfArray([new PdfName('PDF'), new PdfName('ImageC')]));
    resourcesDict.set('XObject', xObjectDict);

    // 6. Page Object
    const pageDict = new PdfDictionary();
    pageDict.set('Type', new PdfName('Page'));
    pageDict.set('MediaBox', mediaBox);
    pageDict.set('BleedBox', bleedBox);
    pageDict.set('TrimBox', trimBox);
    pageDict.set('Contents', contentRef);
    pageDict.set('Resources', resourcesDict);
    const pageRef = writer.addObject(pageDict);

    // 7. Pages Tree
    const pagesDict = new PdfDictionary();
    pagesDict.set('Type', new PdfName('Pages'));
    pagesDict.set('Kids', new PdfArray([pageRef]));
    pagesDict.set('Count', 1);
    const pagesRef = writer.addObject(pagesDict);

    pageDict.set('Parent', pagesRef);

    // 8. Document Catalog (/Root)
    const catalogDict = new PdfDictionary();
    catalogDict.set('Type', new PdfName('Catalog'));
    catalogDict.set('Pages', pagesRef);
    catalogDict.set('OutputIntents', new PdfArray([outputIntentRef]));
    const rootRef = writer.addObject(catalogDict);
    writer.rootRef = rootRef;

    // 9. Document Info Dictionary (/Info)
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
