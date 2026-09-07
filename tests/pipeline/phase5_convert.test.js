/**
 * @file phase5_convert.test.js
 * @description End-to-End conversion pipeline tests for Phase 5 formats:
 * Camera RAW (DNG), Vector (SVG), CAD (DXF), Comics (CBZ), and eBooks (EPUB).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { convert, ExportFormat } from '../../src/pipeline/convert.js';

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

    const localOffset = offset;
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

  const centralOffset = offset;
  let centralSize = 0;
  for (const ch of centralHeaders) centralSize += ch.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

function createMinimalBmp(width, height) {
  const rowSize = (width * 3 + 3) & ~3;
  const imageSize = rowSize * height;
  const fileSize = 54 + imageSize;
  const buf = Buffer.alloc(fileSize);

  buf[0] = 0x42; buf[1] = 0x4D;
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(imageSize, 34);
  buf.writeInt32LE(3780, 38);
  buf.writeInt32LE(3780, 42);

  return buf;
}

test('Phase 5 Pipeline Conversions: "Provide X, Get X"', async (t) => {
  await t.test('E2E: Camera RAW (DNG) -> Demosaic -> Prepress CMYK -> Certified PDF/X-1a', () => {
    // Construct synthetic 4x4 DNG buffer
    const width = 4, height = 4;
    const ifdOffset = 8;
    const numEntries = 5;
    const dataOffset = ifdOffset + 2 + numEntries * 12 + 4;
    const buf = new Uint8Array(dataOffset + width * height * 2);
    const view = new DataView(buf.buffer);

    buf[0] = 0x49; buf[1] = 0x49; buf[2] = 0x2A; buf[3] = 0x00;
    view.setUint32(4, ifdOffset, true);
    view.setUint16(ifdOffset, numEntries, true);
    let e = ifdOffset + 2;
    view.setUint16(e, 0x0100, true); view.setUint16(e + 2, 3, true); view.setUint32(e + 4, 1, true); view.setUint16(e + 8, width, true); e += 12;
    view.setUint16(e, 0x0101, true); view.setUint16(e + 2, 3, true); view.setUint32(e + 4, 1, true); view.setUint16(e + 8, height, true); e += 12;
    view.setUint16(e, 0xC612, true); view.setUint16(e + 2, 1, true); view.setUint32(e + 4, 4, true); view.setUint32(e + 8, 0x01040000, true); e += 12;
    view.setUint16(e, 0x828E, true); view.setUint16(e + 2, 3, true); view.setUint32(e + 4, 1, true); view.setUint16(e + 8, 0, true); e += 12;
    view.setUint16(e, 0x0111, true); view.setUint16(e + 2, 4, true); view.setUint32(e + 4, 1, true); view.setUint32(e + 8, dataOffset, true); e += 12;

    for (let i = 0; i < width * height; i++) {
      view.setUint16(dataOffset + i * 2, 32768, true);
    }

    const pdfBytes = convert(buf, { targetFormat: ExportFormat.PDF_X1A, tacMax: 300 });
    assert.ok(pdfBytes.length > 100);
    const pdfStr = Buffer.from(pdfBytes).toString('latin1');
    assert.ok(pdfStr.startsWith('%PDF-1.3'));
    assert.ok(pdfStr.includes('/GTS_PDFX'));
    assert.ok(pdfStr.includes('/DeviceCMYK'));
  });

  await t.test('E2E: Native SVG Vector Graphic -> Certified PDF/X-4 with Vector Paths', () => {
    const svgStr = `
      <svg viewBox="0 0 500 500" width="500" height="500">
        <rect x="50" y="50" width="200" height="100" />
        <circle cx="250" cy="250" r="80" />
      </svg>
    `;

    const pdfBytes = convert(svgStr, { targetFormat: ExportFormat.PDF_X4 });
    assert.ok(pdfBytes.length > 100);
    const pdfStr = Buffer.from(pdfBytes).toString('latin1');
    assert.ok(pdfStr.startsWith('%PDF-1.6'));
    assert.ok(pdfStr.includes('/GTS_PDFXVersion (PDF/X-4)'));
    assert.ok(pdfStr.includes('/MediaBox [ 0 0 500 500 ]'));
  });

  await t.test('E2E: AutoCAD DXF Architectural Drawing -> Certified PDF/X-1a (Arch D Sheet)', () => {
    const dxfStr = `0
SECTION
2
ENTITIES
0
LINE
10
0.0
20
0.0
11
200.0
21
100.0
0
CIRCLE
10
100.0
20
50.0
40
30.0
0
ENDSEC
0
EOF`;

    const pdfBytes = convert(dxfStr, { targetFormat: ExportFormat.PDF_X1A, paperSize: 'ARCH_D' });
    const pdfStr = Buffer.from(pdfBytes).toString('latin1');
    assert.ok(pdfStr.startsWith('%PDF-1.3'));
    assert.ok(pdfStr.includes('/GTS_PDFX'));
    // Arch D dimensions (2592 x 1728) in MediaBox
    assert.ok(pdfStr.includes('2592'));
    assert.ok(pdfStr.includes('1728'));
  });

  await t.test('E2E: Comic Book Archive (.cbz) -> Multi-Page Certified PDF/X-1a', () => {
    const bmp1 = createMinimalBmp(50, 100);
    const bmp2 = createMinimalBmp(50, 100);
    const cbzZip = createZipBuffer([
      { name: 'ComicInfo.xml', data: '<ComicInfo><Series>Poltergeist Special</Series></ComicInfo>' },
      { name: 'page_1.bmp', data: bmp1 },
      { name: 'page_2.bmp', data: bmp2 }
    ]);

    const pdfBytes = convert(cbzZip, { targetFormat: ExportFormat.PDF_X1A });
    const pdfStr = Buffer.from(pdfBytes).toString('latin1');
    assert.ok(pdfStr.startsWith('%PDF-1.3'));
    assert.ok(pdfStr.includes('/Type /Pages'));
    // 2 pages
    assert.ok(pdfStr.includes('/Count 2'));
  });

  await t.test('E2E: Electronic Publication (.epub) -> Multi-Page Certified PDF/X-1a', () => {
    const epubBuf = createZipBuffer([
      { name: 'mimetype', data: 'application/epub+zip' },
      {
        name: 'META-INF/container.xml',
        data: '<container version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
      },
      {
        name: 'content.opf',
        data: '<package version="3.0"><metadata><dc:title>EBook Sample</dc:title></metadata><manifest><item id="p1" href="p1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="p1"/></spine></package>'
      },
      {
        name: 'p1.xhtml',
        data: '<html><body><p>Text for prepress export</p></body></html>'
      }
    ]);

    const pdfBytes = convert(epubBuf, { targetFormat: ExportFormat.PDF_X1A });
    const pdfStr = Buffer.from(pdfBytes).toString('latin1');
    assert.ok(pdfStr.startsWith('%PDF-1.3'));
    assert.ok(pdfStr.includes('/GTS_PDFX'));
  });
});
