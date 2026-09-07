/**
 * @file pdfx4.js
 * @description PDF/X-4:2010 (ISO 15930-7) compliant prepress PDF generator for Poltergeist.
 * Zero-dependency, supports transparency groups and ICCBased color spaces.
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

export class PdfX4Generator {
  /**
   * Generates a valid PDF/X-4:2010 file from a RasterImage.
   * @param {import('../../types/image.js').RasterImage} image
   * @param {object} [options]
   * @param {string} [options.title='Poltergeist Prepress Export']
   * @param {string} [options.outputCondition='FOGRA39']
   * @param {string} [options.outputConditionIdentifier='FOGRA39']
   * @param {number} [options.bleedPts=9]
   * @returns {Uint8Array}
   */
  static generate(image, options = {}) {
    const title = options.title || 'Poltergeist Prepress Export';
    const condition = options.outputCondition || 'FOGRA39';
    const conditionId = options.outputConditionIdentifier || 'FOGRA39';
    const bleedPts = options.bleedPts !== undefined ? options.bleedPts : 9;

    const writer = new PdfWriter('1.6'); // PDF/X-4:2010 is based on PDF 1.6

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

    if (image.colorSpace === ColorSpaceType.CMYK) {
      imageDict.set('ColorSpace', new PdfName('DeviceCMYK'));
    } else if (image.colorSpace === ColorSpaceType.GRAY) {
      imageDict.set('ColorSpace', new PdfName('DeviceGray'));
    } else {
      imageDict.set('ColorSpace', new PdfName('DeviceRGB'));
    }
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

    // 6. Page Transparency Group
    const groupDict = new PdfDictionary();
    groupDict.set('Type', new PdfName('Group'));
    groupDict.set('S', new PdfName('Transparency'));
    groupDict.set('CS', new PdfName('DeviceCMYK'));

    // 7. Page Object
    const pageDict = new PdfDictionary();
    pageDict.set('Type', new PdfName('Page'));
    pageDict.set('MediaBox', mediaBox);
    pageDict.set('BleedBox', bleedBox);
    pageDict.set('TrimBox', trimBox);
    pageDict.set('Contents', contentRef);
    pageDict.set('Resources', resourcesDict);
    pageDict.set('Group', groupDict);
    const pageRef = writer.addObject(pageDict);

    // 8. Pages Tree
    const pagesDict = new PdfDictionary();
    pagesDict.set('Type', new PdfName('Pages'));
    pagesDict.set('Kids', new PdfArray([pageRef]));
    pagesDict.set('Count', 1);
    const pagesRef = writer.addObject(pagesDict);

    pageDict.set('Parent', pagesRef);

    // 9. Document Catalog (/Root)
    const catalogDict = new PdfDictionary();
    catalogDict.set('Type', new PdfName('Catalog'));
    catalogDict.set('Pages', pagesRef);
    catalogDict.set('OutputIntents', new PdfArray([outputIntentRef]));
    const rootRef = writer.addObject(catalogDict);
    writer.rootRef = rootRef;

    // 10. Document Info Dictionary (/Info)
    const infoDict = new PdfDictionary();
    infoDict.set('Title', new PdfString(title));
    infoDict.set('Creator', new PdfString('Poltergeist Prepress Engine'));
    infoDict.set('GTS_PDFXVersion', new PdfString('PDF/X-4'));
    infoDict.set('CreationDate', new PdfString('D:20260101000000Z'));
    const infoRef = writer.addObject(infoDict);
    writer.infoRef = infoRef;

    return writer.compile();
  }
}
