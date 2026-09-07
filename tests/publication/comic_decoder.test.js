/**
 * @file comic_decoder.test.js
 * @description Comprehensive unit tests for Comic Book Archive (.cbz, .cbr) decoder:
 * natural sorting, double-page spread detection, and ComicInfo.xml extraction.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { ComicDecoder } from '../../src/ingestion/publication/comic_decoder.js';
import { Document } from '../../src/types/document.js';

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

  // BMP Header
  buf[0] = 0x42; buf[1] = 0x4D;
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);

  // DIB Header
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30); // BI_RGB
  buf.writeUInt32LE(imageSize, 34);
  buf.writeInt32LE(3780, 38); // 96 DPI
  buf.writeInt32LE(3780, 42);

  return buf;
}

test('ComicDecoder: Natural Sorting & Spread Detection', async (t) => {
  await t.test('Sorts pages naturally: page_1, page_2, page_10', () => {
    // Single page (portrait 50x100)
    const singlePageBmp = createMinimalBmp(50, 100);
    // Spread page (landscape 200x100 -> ratio 2.0 > 1.2)
    const spreadPageBmp = createMinimalBmp(200, 100);

    const cbzZip = createZipBuffer([
      { name: 'ComicInfo.xml', data: '<ComicInfo><Series>Poltergeist Heroes</Series><Number>1</Number></ComicInfo>' },
      { name: 'page_10.bmp', data: singlePageBmp },
      { name: 'page_1.bmp', data: singlePageBmp },
      { name: 'page_2.bmp', data: spreadPageBmp }
    ]);

    assert.equal(ComicDecoder.probe(cbzZip), true);

    const doc = ComicDecoder.decode(cbzZip);
    assert.ok(doc instanceof Document);
    assert.equal(doc.title, 'Poltergeist Heroes');
    assert.equal(doc.pageCount, 3);

    // Natural sort order must be page_1, page_2, page_10
    const p1 = doc.getPage(1);
    const p2 = doc.getPage(2);
    const p3 = doc.getPage(3);

    assert.equal(p1.metadata.fileName, 'page_1.bmp');
    assert.equal(p1.metadata.isSpread, false); // aspect ratio = 0.5 <= 1.2

    assert.equal(p2.metadata.fileName, 'page_2.bmp');
    assert.equal(p2.metadata.isSpread, true);  // aspect ratio = 2.0 > 1.2

    assert.equal(p3.metadata.fileName, 'page_10.bmp');
  });

  await t.test('Sniffs CBR RAR archive signature', () => {
    const cbrBuf = Buffer.from('Rar!\x1A\x07\x00\0\0\0\0\0\0\0', 'latin1');
    assert.equal(ComicDecoder.probe(cbrBuf), true);
    const doc = ComicDecoder.decode(cbrBuf);
    assert.ok(doc instanceof Document);
    assert.equal(doc.pageCount, 1);
  });

  await t.test('Adversarial: Throws if archive contains no raster images', () => {
    const textZip = createZipBuffer([
      { name: 'read_me.txt', data: 'No images here!' }
    ]);
    assert.equal(ComicDecoder.probe(textZip), false);
    assert.throws(() => ComicDecoder.decode(textZip), /Unsupported or invalid/);
  });
});
