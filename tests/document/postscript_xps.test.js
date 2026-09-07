/**
 * @file postscript_xps.test.js
 * @description Unit tests for PostScript/EPS, OpenXPS, DjVu, and Legacy Office CFBF decoders.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { EpsDecoder } from '../../src/ingestion/document/postscript/eps_decoder.js';
import { XpsDecoder } from '../../src/ingestion/document/xps/xps_decoder.js';
import { LegacyOfficeDecoder } from '../../src/ingestion/document/legacy/legacy_office.js';

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

describe('EpsDecoder: PostScript & EPS Ingestion', () => {
  test('Golden Path: Decodes ASCII PostScript DSC comments (%%BoundingBox, %%Pages)', () => {
    const psText = `%!PS-Adobe-3.0 EPSF-3.0
      %%BoundingBox: 0 0 500 700
      %%Title: Sample Vector Illustration
      %%Creator: Poltergeist Prepress
      %%Pages: 1
      showpage
    `;
    const psBytes = Buffer.from(psText, 'latin1');

    assert.equal(EpsDecoder.probe(psBytes), true);

    const doc = EpsDecoder.decode(psBytes);
    assert.equal(doc.pages.length, 1);
    assert.equal(doc.pages[0].widthPts, 500);
    assert.equal(doc.pages[0].heightPts, 700);
    assert.equal(doc.title, 'Sample Vector Illustration');
  });

  test('Golden Path: Decodes DOS binary EPS header (0xC5D0D3C6)', () => {
    const psText = `%!PS-Adobe-3.0 EPSF-3.0
      %%BoundingBox: 10 10 310 410
      showpage
    `;
    const psBytes = Buffer.from(psText, 'latin1');

    // DOS EPS 30-byte header
    const header = Buffer.alloc(30);
    header.writeUInt8(0xC5, 0);
    header.writeUInt8(0xD0, 1);
    header.writeUInt8(0xD3, 2);
    header.writeUInt8(0xC6, 3);
    header.writeUInt32LE(30, 4); // PS offset = 30
    header.writeUInt32LE(psBytes.length, 8); // PS length

    const dosEps = Buffer.concat([header, psBytes]);

    assert.equal(EpsDecoder.probe(dosEps), true);

    const doc = EpsDecoder.decode(dosEps);
    assert.equal(doc.pages.length, 1);
    assert.equal(doc.pages[0].widthPts, 300); // 310 - 10
    assert.equal(doc.pages[0].heightPts, 400); // 410 - 10
  });
});

describe('XpsDecoder: OpenXPS and DjVu Ingestion', () => {
  test('Golden Path: Decodes OpenXPS DIP dimensions to PDF points', () => {
    // 816 x 1056 DIPs (1/96") = 612 x 792 pt (1/72")
    const fpageXml = `<FixedPage Width="816" Height="1056" xml:lang="en-US"/>`;

    const xpsZip = createZipBuffer([
      { name: 'FixedDocumentSequence.fdseq', data: '<Sequence/>', method: 0 },
      { name: 'Documents/1/Pages/1.fpage', data: fpageXml, method: 0 }
    ]);

    assert.equal(XpsDecoder.probe(xpsZip), true);

    const doc = XpsDecoder.decode(xpsZip);
    assert.equal(doc.pages.length, 1);
    assert.equal(doc.pages[0].widthPts, 612);
    assert.equal(doc.pages[0].heightPts, 792);
  });

  test('Golden Path: Decodes DjVu INFO chunk header', () => {
    // DjVu starts with 'AT&T' + 'FORM' + 4-byte size + 'DJVU'
    // INFO chunk: 'INFO' + 4-byte size (10) + 2-byte width + 2-byte height + 1-byte minor + 1-byte major + 2-byte dpi
    const djvuBuf = Buffer.alloc(40);
    djvuBuf.write('AT&T', 0, 'latin1');
    djvuBuf.write('FORM', 4, 'latin1');
    djvuBuf.writeUInt32BE(28, 8);
    djvuBuf.write('DJVU', 12, 'latin1');

    // INFO chunk
    djvuBuf.write('INFO', 16, 'latin1');
    djvuBuf.writeUInt32BE(10, 20); // Length = 10
    djvuBuf.writeUInt16BE(2550, 24); // 2550 pixels (8.5 inches at 300 DPI)
    djvuBuf.writeUInt16BE(3300, 26); // 3300 pixels (11 inches at 300 DPI)
    djvuBuf.writeUInt8(26, 28); // Version
    djvuBuf.writeUInt8(0, 29);
    djvuBuf.writeUInt16LE(300, 30); // 300 DPI

    assert.equal(XpsDecoder.probe(djvuBuf), true);

    const doc = XpsDecoder.decode(djvuBuf);
    assert.equal(doc.pages.length, 1);
    assert.equal(doc.pages[0].widthPts, 612);
    assert.equal(doc.pages[0].heightPts, 792);
  });
});

describe('LegacyOfficeDecoder: Compound File Binary Format (CFBF)', () => {
  test('Golden Path: Detects WordDocument stream in CFBF container', () => {
    // CFBF header (512 bytes)
    const cfbf = Buffer.alloc(512 + 128);
    // Magic: D0 CF 11 E0 A1 B1 1A E1
    cfbf.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], 0);
    cfbf.writeUInt16LE(9, 30); // Sector shift = 9 (512 bytes)
    cfbf.writeUInt32LE(0, 48); // First directory sector = 0 (offset 512)

    // Directory Entry 0: "WordDocument" in UTF-16LE
    const dirEntryOffset = 512;
    const name = 'WordDocument\0';
    const nameBuf = Buffer.from(name, 'utf16le');
    nameBuf.copy(cfbf, dirEntryOffset);
    cfbf.writeUInt16LE(nameBuf.length, dirEntryOffset + 64);

    assert.equal(LegacyOfficeDecoder.probe(cfbf), true);

    const doc = LegacyOfficeDecoder.decode(cfbf);
    assert.equal(doc.pages.length, 1);
    assert.equal(doc.pages[0].widthPts, 612);
    assert.equal(doc.pages[0].heightPts, 792);
    assert.equal(doc.pages[0].metadata.format, 'doc');
  });
});
