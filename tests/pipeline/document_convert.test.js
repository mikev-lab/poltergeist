/**
 * @file document_convert.test.js
 * @description End-to-end integration tests for multi-page document conversions:
 * Word (.docx), InDesign (IDML), Self-Healing PDF -> Certified PDF/X-1a & PDF/X-4.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { convert, ExportFormat } from '../../src/pipeline/convert.js';
import { PdfDecoder } from '../../src/ingestion/pdf/pdf_decoder.js';
import { PdfWriter } from '../../src/export/pdf/writer.js';
import { PdfDictionary, PdfName, PdfArray, PdfString, PdfStream } from '../../src/export/pdf/objects.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../src/types/image.js';
import { Document, PageRecord, PageBox } from '../../src/types/document.js';

function createZipBuffer(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const rawData = typeof file.data === 'string' ? Buffer.from(file.data, 'utf8') : file.data;
    const nameBuf = Buffer.from(file.name, 'utf8');
    const method = file.method !== undefined ? file.method : 0;

    let compData = rawData;
    if (method === 8) {
      compData = zlib.deflateRawSync(rawData);
    }

    const localOffset = offset;
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compData.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compData);
    offset += localHeader.length + compData.length;

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compData.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
  }

  const centralDirStart = offset;
  const centralDirBuf = Buffer.concat(centralHeaders);
  const centralDirSize = centralDirBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, centralDirBuf, eocd]);
}

describe('Document Pipeline: End-to-End Multi-Page Conversions', () => {
  test('E2E: Word .docx -> Multi-Page Certified PDF/X-1a', () => {
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Page 1 Title</w:t></w:r></w:p>
          <w:p><w:r><w:br w:type="page"/></w:r></w:p>
          <w:p><w:r><w:t>Page 2 Chapter</w:t></w:r></w:p>
          <w:p><w:r><w:br w:type="page"/></w:r></w:p>
          <w:p><w:r><w:t>Page 3 Index</w:t></w:r></w:p>
          <w:sectPr>
            <w:pgSz w:w="12240" w:h="15840"/>
          </w:sectPr>
        </w:body>
      </w:document>
    `;

    const wordBytes = createZipBuffer([
      { name: 'word/document.xml', data: docXml, method: 8 }
    ]);

    const pdfx1aBytes = convert(wordBytes, {
      targetFormat: ExportFormat.PDF_X1A,
      title: 'Converted Word Document'
    });

    assert.ok(pdfx1aBytes instanceof Uint8Array);
    assert.ok(pdfx1aBytes.length > 500);

    // Decode generated PDF to verify multi-page structure
    const decodedDoc = PdfDecoder.decode(pdfx1aBytes);
    assert.equal(decodedDoc.pages.length, 3);
    for (let i = 0; i < 3; i++) {
      assert.equal(decodedDoc.pages[i].widthPts, 612);
      assert.equal(decodedDoc.pages[i].heightPts, 792);
    }
  });

  test('E2E: InDesign IDML -> Certified PDF/X-4', () => {
    const spreadXml = `<?xml version="1.0" encoding="UTF-8"?>
      <idPkg:Spread xmlns:idPkg="http://schemas.adobe.com/idml/1.0/packaging">
        <Spread Self="sp1" BleedTop="9" BleedBottom="9">
          <Page Self="p1" GeometricBounds="0 0 792 612"/>
        </Spread>
      </idPkg:Spread>
    `;

    const idmlBytes = createZipBuffer([
      { name: 'mimetype', data: 'application/vnd.adobe.indesign-idml-package', method: 0 },
      { name: 'designmap.xml', data: '<Document/>', method: 0 },
      { name: 'Spreads/Spread_1.xml', data: spreadXml, method: 8 }
    ]);

    const pdfx4Bytes = convert(idmlBytes, {
      targetFormat: ExportFormat.PDF_X4
    });

    assert.ok(pdfx4Bytes instanceof Uint8Array);

    const decoded = PdfDecoder.decode(pdfx4Bytes);
    assert.equal(decoded.pages.length, 1);
    // MediaBox includes bleed: 612 + 18 = 630, 792 + 18 = 810
    assert.equal(decoded.pages[0].widthPts, 630);
    assert.equal(decoded.pages[0].heightPts, 810);
    // TrimBox preserves exact page dimensions: 612 x 792
    assert.equal(decoded.pages[0].pageBox.trimWidth, 612);
    assert.equal(decoded.pages[0].pageBox.trimHeight, 792);
  });

  test('E2E: Damaged PDF (missing startxref/trailer) -> Self-Healing -> Certified PDF/X-1a', () => {
    const writer = new PdfWriter('1.4');
    const p1Content = writer.addObject(new PdfStream(new PdfDictionary(), Buffer.from('q Q\n', 'latin1'), false));
    const pagesDict = new PdfDictionary();
    pagesDict.set('Type', new PdfName('Pages'));
    pagesDict.set('MediaBox', new PdfArray([0, 0, 500, 700]));
    const pagesRef = writer.addObject(pagesDict);

    const page1Dict = new PdfDictionary();
    page1Dict.set('Type', new PdfName('Page'));
    page1Dict.set('Parent', pagesRef);
    page1Dict.set('Contents', p1Content);
    const p1Ref = writer.addObject(page1Dict);

    pagesDict.set('Kids', new PdfArray([p1Ref]));
    pagesDict.set('Count', 1);

    const catalogDict = new PdfDictionary();
    catalogDict.set('Type', new PdfName('Catalog'));
    catalogDict.set('Pages', pagesRef);
    writer.rootRef = writer.addObject(catalogDict);

    const intactPdf = writer.compile();

    // Damage PDF by chopping off xref table
    const text = new TextDecoder('latin1').decode(intactPdf);
    const xrefPos = text.lastIndexOf('xref\n');
    const damagedPdf = Buffer.from(intactPdf.subarray(0, xrefPos));

    // Convert damaged PDF directly
    const convertedBytes = convert(damagedPdf, {
      targetFormat: ExportFormat.PDF_X1A
    });

    const repairedDoc = PdfDecoder.decode(convertedBytes);
    assert.equal(repairedDoc.pages.length, 1);
    assert.equal(repairedDoc.pages[0].widthPts, 500);
    assert.equal(repairedDoc.pages[0].heightPts, 700);
  });

  test('E2E: Multi-Page Document with RGB images -> Auto CMYK + TAC 300% -> Certified PDF/X-1a', () => {
    // 2-page document with RGB background images
    const rgbImg1 = new RasterImage({
      width: 100,
      height: 100,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      dpiX: 300,
      dpiY: 300,
      data: new Uint8Array(100 * 100 * 3).fill(200)
    });

    const rgbImg2 = new RasterImage({
      width: 100,
      height: 100,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      dpiX: 300,
      dpiY: 300,
      data: new Uint8Array(100 * 100 * 3).fill(50)
    });

    const doc = new Document({
      title: 'Multi-Page CMYK Test',
      pages: [
        new PageRecord({ pageNumber: 1, width: 612, height: 792, image: rgbImg1 }),
        new PageRecord({ pageNumber: 2, width: 612, height: 792, image: rgbImg2 })
      ]
    });

    const pdfx1a = convert(doc, {
      targetFormat: ExportFormat.PDF_X1A,
      tacMax: 300
    });

    const decoded = PdfDecoder.decode(pdfx1a);
    assert.equal(decoded.pages.length, 2);
    assert.equal(decoded.pages[0].widthPts, 612);
    assert.equal(decoded.pages[1].widthPts, 612);
  });
});
