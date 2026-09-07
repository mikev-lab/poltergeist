/**
 * @file pdf_export.test.js
 * @description Unit and compliance tests for PdfWriter, PdfX1aGenerator, and PdfX4Generator.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PdfWriter } from '../../src/export/pdf/writer.js';
import { PdfX1aGenerator } from '../../src/export/pdf/pdfx1a.js';
import { PdfX4Generator } from '../../src/export/pdf/pdfx4.js';
import { PdfDictionary, PdfName, PdfString } from '../../src/export/pdf/objects.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../src/types/image.js';

describe('PdfWriter: Low-Level Serialization & Xref Integrity', () => {
  it('Golden Path: Compiles minimal valid PDF with indirect objects, xref, and trailer', () => {
    const writer = new PdfWriter('1.4');
    const dict = new PdfDictionary();
    dict.set('TestKey', new PdfString('TestVal'));
    const ref = writer.addObject(dict);
    writer.rootRef = ref;

    const pdfBytes = writer.compile();
    const pdfStr = Buffer.from(pdfBytes).toString('latin1');

    assert.ok(pdfStr.startsWith('%PDF-1.4'));
    assert.ok(pdfStr.includes('1 0 obj'));
    assert.ok(pdfStr.includes('/TestKey (TestVal)'));
    assert.ok(pdfStr.includes('endobj'));
    assert.ok(pdfStr.includes('xref\n0 2\n'));
    assert.ok(pdfStr.includes('trailer'));
    assert.ok(pdfStr.includes('startxref'));
    assert.ok(pdfStr.endsWith('%%EOF\n'));
  });
});

describe('PdfX1aGenerator: PDF/X-1a:2001 Prepress Compliance', () => {
  it('Golden Path: Generates certified PDF/X-1a file from CMYK raster', () => {
    // 100x100 CMYK image at 300 DPI
    const data = new Uint8Array(100 * 100 * 4);
    data.fill(50);

    const image = new RasterImage({
      width: 100,
      height: 100,
      channels: 4,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.CMYK,
      pixelFormat: PixelFormat.CMYK32,
      dpiX: 300,
      dpiY: 300,
      data
    });

    const pdfBytes = PdfX1aGenerator.generate(image, {
      title: 'Commercial Proof',
      outputCondition: 'CGATS TR 001',
      bleedPts: 9
    });

    const pdfStr = Buffer.from(pdfBytes).toString('latin1');

    // 1. Check version (PDF 1.3)
    assert.ok(pdfStr.startsWith('%PDF-1.3'));

    // 2. Check DeviceCMYK color space
    assert.ok(pdfStr.includes('/ColorSpace /DeviceCMYK'));

    // 3. Check PDF/X-1a version string in Info dictionary
    assert.ok(pdfStr.includes('/GTS_PDFXVersion (PDF/X-1a:2001)'));

    // 4. Check OutputIntents dictionary
    assert.ok(pdfStr.includes('/S /GTS_PDFX'));
    assert.ok(pdfStr.includes('/OutputCondition (CGATS TR 001)'));

    // 5. Check TrimBox and BleedBox geometry
    assert.ok(pdfStr.includes('/TrimBox'));
    assert.ok(pdfStr.includes('/BleedBox'));
    assert.ok(pdfStr.includes('/MediaBox'));

    // 6. Prepress rule: zero live transparency dictionaries
    assert.ok(!pdfStr.includes('/SMask'));
    assert.ok(!pdfStr.includes('/Transparency'));
  });

  it('Compliance Rule: Rejects non-CMYK images for PDF/X-1a', () => {
    const rgbImage = new RasterImage({
      width: 10,
      height: 10,
      channels: 3,
      colorSpace: ColorSpaceType.RGB
    });

    assert.throws(() => {
      PdfX1aGenerator.generate(rgbImage);
    }, /requires DeviceCMYK/i);
  });
});

describe('PdfX4Generator: PDF/X-4:2010 Prepress Compliance', () => {
  it('Golden Path: Generates certified PDF/X-4 file with transparency group', () => {
    const data = new Uint8Array(50 * 50 * 4);
    const image = new RasterImage({
      width: 50,
      height: 50,
      channels: 4,
      colorSpace: ColorSpaceType.CMYK,
      data
    });

    const pdfBytes = PdfX4Generator.generate(image, {
      title: 'Modern Proof',
      outputCondition: 'FOGRA39'
    });

    const pdfStr = Buffer.from(pdfBytes).toString('latin1');

    // 1. Check PDF 1.6 version
    assert.ok(pdfStr.startsWith('%PDF-1.6'));

    // 2. Check PDF/X-4 version in Info
    assert.ok(pdfStr.includes('/GTS_PDFXVersion (PDF/X-4)'));

    // 3. Check Transparency Group
    assert.ok(pdfStr.includes('/Type /Group'));
    assert.ok(pdfStr.includes('/S /Transparency'));

    // 4. Check OutputIntent
    assert.ok(pdfStr.includes('/OutputCondition (FOGRA39)'));
  });
});
