/**
 * @file convert_split.test.js
 * @description Comprehensive unit and integration tests for Poltergeist's
 * document page splitting, high-res/true-res manga proofing, screentone preservation,
 * and page range filtering.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { convert, ExportFormat } from '../../src/pipeline/convert.js';
import { PdfDecoder } from '../../src/ingestion/pdf/pdf_decoder.js';
import { TiffDecoder } from '../../src/ingestion/raster/tiff/tiff_decoder.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../src/types/image.js';
import { Document, PageRecord } from '../../src/types/document.js';

function createSynthetic3PageDocument() {
  const img1 = new RasterImage({
    width: 200,
    height: 300,
    channels: 3,
    bitsPerSample: 8,
    colorSpace: ColorSpaceType.RGB,
    pixelFormat: PixelFormat.RGB24,
    dpiX: 300,
    dpiY: 300,
    data: new Uint8Array(200 * 300 * 3).fill(220)
  });

  const img2 = new RasterImage({
    width: 200,
    height: 300,
    channels: 3,
    bitsPerSample: 8,
    colorSpace: ColorSpaceType.RGB,
    pixelFormat: PixelFormat.RGB24,
    dpiX: 300,
    dpiY: 300,
    data: new Uint8Array(200 * 300 * 3).fill(150)
  });

  const img3 = new RasterImage({
    width: 200,
    height: 300,
    channels: 3,
    bitsPerSample: 8,
    colorSpace: ColorSpaceType.RGB,
    pixelFormat: PixelFormat.RGB24,
    dpiX: 300,
    dpiY: 300,
    data: new Uint8Array(200 * 300 * 3).fill(80)
  });

  return new Document({
    title: 'Multi-Page Test Magazine',
    pages: [
      new PageRecord({ pageNumber: 1, width: 612, height: 792, image: img1 }),
      new PageRecord({ pageNumber: 2, width: 612, height: 792, image: img2 }),
      new PageRecord({ pageNumber: 3, width: 612, height: 792, image: img3 })
    ]
  });
}

describe('Pipeline: Document Page Splitting & Page Range Filtering', () => {
  test('Golden Path: Split 3-page document into individual single-page PDF/X-1a files', () => {
    const doc = createSynthetic3PageDocument();
    const result = convert(doc, {
      splitPages: true,
      targetFormat: ExportFormat.PDF_X1A
    });

    assert.ok(result instanceof Map, 'Expected Map result when splitPages is true');
    assert.equal(result.size, 3);
    assert.ok(result.has('page_1.pdf'));
    assert.ok(result.has('page_2.pdf'));
    assert.ok(result.has('page_3.pdf'));

    for (let p = 1; p <= 3; p++) {
      const pdfBytes = result.get(`page_${p}.pdf`);
      assert.ok(pdfBytes instanceof Uint8Array);
      assert.ok(pdfBytes.length > 500);

      const decoded = PdfDecoder.decode(pdfBytes);
      assert.equal(decoded.pages.length, 1, `Expected page_${p}.pdf to contain exactly 1 page`);
      assert.equal(decoded.pages[0].widthPts, 612);
      assert.equal(decoded.pages[0].heightPts, 792);
    }
  });

  test('Dual Output: Split PDF/X-4 print target + 72 DPI screen proof JPEGs in a single pass', () => {
    const doc = createSynthetic3PageDocument();
    const result = convert(doc, {
      splitPages: true,
      targetFormat: ExportFormat.PDF_X4,
      renderProofs: true,
      proofDpi: 72
    });

    assert.ok(result instanceof Map);
    assert.equal(result.size, 6, 'Expected 3 print PDFs + 3 proof JPEGs');

    assert.ok(result.has('page_1.pdf'));
    assert.ok(result.has('page_1.jpg'));
    assert.ok(result.has('page_2.pdf'));
    assert.ok(result.has('page_2.jpg'));
    assert.ok(result.has('page_3.pdf'));
    assert.ok(result.has('page_3.jpg'));

    // Verify PDF
    const pdf1 = PdfDecoder.decode(result.get('page_1.pdf'));
    assert.equal(pdf1.pages.length, 1);

    // Verify JPEG magic bytes (FF D8 FF)
    const jpg1 = result.get('page_1.jpg');
    assert.equal(jpg1[0], 0xff);
    assert.equal(jpg1[1], 0xd8);
    assert.equal(jpg1[2], 0xff);
  });

  test('Master PDF + Individual Proofs: Combined 3-page PDF/X-1a with individual 72 DPI JPEGs', () => {
    const doc = createSynthetic3PageDocument();
    const result = convert(doc, {
      splitPages: false,
      targetFormat: ExportFormat.PDF_X1A,
      renderProofs: true,
      proofDpi: 72,
      jobName: 'annual_report'
    });

    assert.ok(result instanceof Map);
    assert.equal(result.size, 4, 'Expected 1 combined PDF + 3 proof JPEGs');
    assert.ok(result.has('annual_report.pdf'));
    assert.ok(result.has('page_1.jpg'));
    assert.ok(result.has('page_2.jpg'));
    assert.ok(result.has('page_3.jpg'));

    const fullPdf = PdfDecoder.decode(result.get('annual_report.pdf'));
    assert.equal(fullPdf.pages.length, 3, 'Combined PDF must contain all 3 pages');
  });

  test('Multi-tier proofing: Generate both 72 DPI thumbnail and 300 DPI master proofs', () => {
    const doc = createSynthetic3PageDocument();
    const result = convert(doc, {
      splitPages: true,
      targetFormat: ExportFormat.PDF_X1A,
      renderProofs: true,
      proofDpi: [72, 300]
    });

    assert.ok(result instanceof Map);
    // 3 PDF pages + 3 x 72 DPI JPEGs + 3 x 300 DPI JPEGs = 9 files
    assert.equal(result.size, 9);
    assert.ok(result.has('page_1.pdf'));
    assert.ok(result.has('page_1_72dpi.jpg'));
    assert.ok(result.has('page_1_300dpi.jpg'));
    assert.ok(result.has('page_2.pdf'));
    assert.ok(result.has('page_2_72dpi.jpg'));
    assert.ok(result.has('page_2_300dpi.jpg'));
  });

  test('Custom Page Naming: pageNaming callback formats output file names', () => {
    const doc = createSynthetic3PageDocument();
    const result = convert(doc, {
      splitPages: true,
      targetFormat: ExportFormat.PDF_X1A,
      renderProofs: true,
      proofDpi: 72,
      pageNaming: (pageNum) => `vol01_p${String(pageNum).padStart(3, '0')}`
    });

    assert.ok(result instanceof Map);
    assert.ok(result.has('vol01_p001.pdf'));
    assert.ok(result.has('vol01_p001.jpg'));
    assert.ok(result.has('vol01_p002.pdf'));
    assert.ok(result.has('vol01_p002.jpg'));
    assert.ok(result.has('vol01_p003.pdf'));
    assert.ok(result.has('vol01_p003.jpg'));
  });

  test('Page Range Filtering: Extract single page (page: 2) as standalone Uint8Array', () => {
    const doc = createSynthetic3PageDocument();
    const result = convert(doc, {
      targetFormat: ExportFormat.PDF_X1A,
      page: 2
    });

    // When a single page is extracted without splitPages or renderProofs, returns Uint8Array
    assert.ok(result instanceof Uint8Array);
    const decoded = PdfDecoder.decode(result);
    assert.equal(decoded.pages.length, 1);
  });

  test('Page Range Filtering: Extract subset of pages (pages: [1, 3]) with splitPages', () => {
    const doc = createSynthetic3PageDocument();
    const result = convert(doc, {
      splitPages: true,
      targetFormat: ExportFormat.PDF_X1A,
      pages: [1, 3]
    });

    assert.ok(result instanceof Map);
    assert.equal(result.size, 2);
    assert.ok(result.has('page_1.pdf'));
    assert.ok(!result.has('page_2.pdf'));
    assert.ok(result.has('page_3.pdf'));
  });
});

describe('Pipeline: Manga Screentone & True-Resolution Proofing', () => {
  test('600 DPI Manga Halftone: Bypass downsampling preserves exact raster dimensions', () => {
    // 600 DPI bitmap / grayscale screentone (e.g., 1200 x 1800 px at 2" x 3")
    const mangaTone = new RasterImage({
      width: 1200,
      height: 1800,
      channels: 1,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.GRAY,
      pixelFormat: PixelFormat.GRAY8,
      dpiX: 600,
      dpiY: 600,
      data: new Uint8Array(1200 * 1800)
    });

    // Halftone dot pattern
    for (let y = 0; y < 1800; y++) {
      for (let x = 0; x < 1200; x++) {
        mangaTone.data[y * 1200 + x] = ((x % 6 < 3) && (y % 6 < 3)) ? 0 : 255;
      }
    }

    const doc = new Document({
      title: 'Manga Screentone Chapter',
      pages: [
        new PageRecord({ pageNumber: 1, width: 144, height: 216, image: mangaTone, dpi: 600 })
      ]
    });

    // 1. With bypassDownsampling: true and proofDpi: 'native', proofFormat: 'tiff'
    const preservedResult = convert(doc, {
      targetFormat: ExportFormat.PDF_X1A,
      bypassDownsampling: true,
      renderProofs: true,
      proofDpi: 'native',
      proofFormat: 'tiff'
    });

    assert.ok(preservedResult instanceof Map);
    assert.ok(preservedResult.has('page_1_native.tif'));

    const tiffBytes = preservedResult.get('page_1_native.tif');
    const decodedTiff = TiffDecoder.decode(tiffBytes);
    assert.equal(decodedTiff.width, 1200, 'Native TIFF proof must preserve 1200px width without downsampling');
    assert.equal(decodedTiff.height, 1800, 'Native TIFF proof must preserve 1800px height without downsampling');

    // 2. Default behavior (without bypassDownsampling): threshold >450 DPI downsamples to 300 DPI
    const downsampledResult = convert(doc, {
      targetFormat: ExportFormat.PDF_X1A,
      downsample: true,
      renderProofs: true,
      proofDpi: 300,
      proofFormat: 'tiff'
    });

    assert.ok(downsampledResult instanceof Map);
    const downsampledTiff = TiffDecoder.decode(downsampledResult.get('page_1.tif'));
    // At 144 pt x 216 pt at 300 DPI: (144 / 72) * 300 = 600 px, (216 / 72) * 300 = 900 px
    assert.equal(downsampledTiff.width, 600);
    assert.equal(downsampledTiff.height, 900);
  });

  test('Single Raster Image: Proofing with jobName and native TIFF output', () => {
    const singleRaster = new RasterImage({
      width: 600,
      height: 900,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      dpiX: 600,
      dpiY: 600,
      data: new Uint8Array(600 * 900 * 3).fill(128)
    });

    const result = convert(singleRaster, {
      targetFormat: ExportFormat.PDF_X1A,
      jobName: 'manga_cover',
      renderProofs: true,
      proofDpi: 'native',
      proofFormat: 'tiff',
      bypassDownsampling: true
    });

    assert.ok(result instanceof Map);
    assert.equal(result.size, 2);
    assert.ok(result.has('manga_cover.pdf'));
    assert.ok(result.has('manga_cover_proof_native.tif'));

    const tiffBuf = result.get('manga_cover_proof_native.tif');
    const decoded = TiffDecoder.decode(tiffBuf);
    assert.equal(decoded.width, 600);
    assert.equal(decoded.height, 900);
  });

  test('1200 DPI Ultra-Fine Manga Line Art: Preserved losslessly via bypassDownsampling', () => {
    const manga1200 = new RasterImage({
      width: 1200,
      height: 1200,
      channels: 1,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.GRAY,
      pixelFormat: PixelFormat.GRAY8,
      dpiX: 1200,
      dpiY: 1200,
      data: new Uint8Array(1200 * 1200)
    });

    const doc = new Document({
      pages: [
        new PageRecord({ pageNumber: 1, width: 72, height: 72, image: manga1200, dpi: 1200 })
      ]
    });

    const result = convert(doc, {
      targetFormat: ExportFormat.PDF_X1A,
      preserveResolution: true,
      renderProofs: true,
      proofDpi: 1200,
      proofFormat: 'tiff'
    });

    assert.ok(result instanceof Map);
    const proofTiff = TiffDecoder.decode(result.get('page_1.tif'));
    assert.equal(proofTiff.width, 1200);
    assert.equal(proofTiff.height, 1200);
  });

  test('Split to TIFF & TIFFSEP: Export single-page TIFF files and discrete separation plates', () => {
    const doc = createSynthetic3PageDocument();
    const tiffResult = convert(doc, {
      splitPages: true,
      targetFormat: ExportFormat.TIFF
    });

    assert.ok(tiffResult instanceof Map);
    assert.equal(tiffResult.size, 3);
    assert.ok(tiffResult.has('page_1.tif'));
    assert.ok(tiffResult.has('page_2.tif'));
    assert.ok(tiffResult.has('page_3.tif'));

    const sepResult = convert(doc, {
      splitPages: true,
      targetFormat: ExportFormat.TIFFSEP
    });

    assert.ok(sepResult instanceof Map);
    assert.ok(sepResult.has('page_1_Cyan.tif'));
    assert.ok(sepResult.has('page_1_Magenta.tif'));
    assert.ok(sepResult.has('page_1_Yellow.tif'));
    assert.ok(sepResult.has('page_1_Black.tif'));
  });
});

describe('Pipeline: Error Handling & Bounds Checking (Rule 6 & Rule 15)', () => {
  test('Deep Edge Case: 1x1 pixel image proofing with renderProofs: true', () => {
    const tinyRaster = new RasterImage({
      width: 1,
      height: 1,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      dpiX: 72,
      dpiY: 72,
      data: new Uint8Array([255, 0, 0])
    });

    const result = convert(tinyRaster, {
      targetFormat: ExportFormat.PDF_X1A,
      renderProofs: true,
      proofDpi: 72
    });

    assert.ok(result instanceof Map);
    assert.ok(result.has('image.pdf'));
    assert.ok(result.has('image_proof.jpg'));
  });

  test('Rejects out-of-bounds page index (page: 0)', () => {
    const doc = createSynthetic3PageDocument();
    assert.throws(
      () => convert(doc, { page: 0 }),
      {
        name: 'RangeError',
        message: /Requested page 0 is out of document bounds \(1\.\.3\)/
      }
    );
  });

  test('Rejects out-of-bounds page index (page: 99)', () => {
    const doc = createSynthetic3PageDocument();
    assert.throws(
      () => convert(doc, { page: 99 }),
      {
        name: 'RangeError',
        message: /Requested page 99 is out of document bounds \(1\.\.3\)/
      }
    );
  });

  test('Rejects invalid non-integer page index (page: 1.5)', () => {
    const doc = createSynthetic3PageDocument();
    assert.throws(
      () => convert(doc, { page: 1.5 }),
      {
        name: 'RangeError',
        message: /Requested page 1.5 is out of document bounds \(1\.\.3\)/
      }
    );
  });

  test('Rejects out-of-bounds entry in pages array', () => {
    const doc = createSynthetic3PageDocument();
    assert.throws(
      () => convert(doc, { pages: [1, 5] }),
      {
        name: 'RangeError',
        message: /Requested page 5 is out of document bounds \(1\.\.3\)/
      }
    );
  });

  test('Backward compatibility: Single page document returns single Uint8Array without splitPages', () => {
    const doc = new Document({
      title: 'Single Page',
      pages: [
        new PageRecord({ pageNumber: 1, width: 612, height: 792 })
      ]
    });

    const result = convert(doc, { targetFormat: ExportFormat.PDF_X1A });
    assert.ok(result instanceof Uint8Array, 'Default convert without splitting must return Uint8Array');
  });
});

