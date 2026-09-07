/**
 * @file zip_reader.test.js
 * @description Comprehensive unit tests for ZipReader: golden paths, deep edge cases, and adversarial security.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { ZipReader } from '../../src/ingestion/common/zip_reader.js';

/**
 * In-memory ZIP archive generator for testing.
 * @param {Array<{name: string, data: Uint8Array|string, method?: number}>} files
 * @returns {Uint8Array}
 */
function createZipBuffer(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const rawData = typeof file.data === 'string' ? Buffer.from(file.data, 'utf8') : file.data;
    const nameBuf = Buffer.from(file.name, 'utf8');
    const method = file.method !== undefined ? file.method : 0; // 0 = Stored, 8 = Deflate

    let compData = rawData;
    if (method === 8) {
      compData = zlib.deflateRawSync(rawData);
    }

    const localOffset = offset;

    // Local Header (30 bytes + nameLen)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // sig
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(method, 8); // method
    localHeader.writeUInt16LE(0, 10); // time
    localHeader.writeUInt16LE(0, 12); // date
    localHeader.writeUInt32LE(0, 14); // crc32
    localHeader.writeUInt32LE(compData.length, 18); // compSize
    localHeader.writeUInt32LE(rawData.length, 22); // uncompSize
    localHeader.writeUInt16LE(nameBuf.length, 26); // nameLen
    localHeader.writeUInt16LE(0, 28); // extraLen
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compData);
    offset += localHeader.length + compData.length;

    // Central Directory Header (46 bytes + nameLen)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // sig
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(method, 10); // method
    centralHeader.writeUInt16LE(0, 12); // time
    centralHeader.writeUInt16LE(0, 14); // date
    centralHeader.writeUInt32LE(0, 16); // crc32
    centralHeader.writeUInt32LE(compData.length, 20); // compSize
    centralHeader.writeUInt32LE(rawData.length, 24); // uncompSize
    centralHeader.writeUInt16LE(nameBuf.length, 28); // nameLen
    centralHeader.writeUInt16LE(0, 30); // extraLen
    centralHeader.writeUInt16LE(0, 32); // commentLen
    centralHeader.writeUInt16LE(0, 34); // diskStart
    centralHeader.writeUInt16LE(0, 36); // internalAttrs
    centralHeader.writeUInt32LE(0, 38); // externalAttrs
    centralHeader.writeUInt32LE(localOffset, 42); // localHeaderOffset
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
  }

  const centralDirStart = offset;
  const centralDirBuf = Buffer.concat(centralHeaders);
  const centralDirSize = centralDirBuf.length;

  // EOCD (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // sig
  eocd.writeUInt16LE(0, 4); // disk num
  eocd.writeUInt16LE(0, 6); // disk start
  eocd.writeUInt16LE(files.length, 8); // entries on disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12); // central dir size
  eocd.writeUInt32LE(centralDirStart, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, centralDirBuf, eocd]);
}

describe('ZipReader: Pure Native ZIP Package Ingestion', () => {
  test('Golden Path: Decompresses Stored and Deflated files', () => {
    const zipData = createZipBuffer([
      { name: 'mimetype', data: 'application/vnd.adobe.indesign-idml-package', method: 0 },
      { name: 'content.txt', data: 'Hello Poltergeist Prepress Engine!', method: 8 },
      { name: 'dir/', data: '', method: 0 }
    ]);

    assert.equal(ZipReader.probe(zipData), true);

    const zip = new ZipReader(zipData);
    assert.equal(zip.has('mimetype'), true);
    assert.equal(zip.has('content.txt'), true);
    assert.equal(zip.has('dir/'), true);
    assert.equal(zip.has('nonexistent.bin'), false);

    const mime = zip.readText('mimetype');
    assert.equal(mime, 'application/vnd.adobe.indesign-idml-package');

    const content = zip.readText('content.txt');
    assert.equal(content, 'Hello Poltergeist Prepress Engine!');

    const dirBytes = zip.read('dir/');
    assert.equal(dirBytes.length, 0);
  });

  test('Adversarial: Zip-Slip path traversal rejection', () => {
    const maliciousZip = createZipBuffer([
      { name: '../../etc/passwd', data: 'root:x:0:0', method: 0 }
    ]);

    assert.throws(() => {
      new ZipReader(maliciousZip);
    }, /Disallowed path traversal in ZIP entry/);

    const maliciousRootZip = createZipBuffer([
      { name: '/etc/shadow', data: 'root:x:0:0', method: 0 }
    ]);

    assert.throws(() => {
      new ZipReader(maliciousRootZip);
    }, /Disallowed path traversal in ZIP entry/);
  });

  test('Adversarial: Corrupted EOCD and truncated archives', () => {
    const validZip = createZipBuffer([
      { name: 'test.txt', data: 'data', method: 0 }
    ]);

    // Truncate to < 22 bytes
    assert.throws(() => {
      new ZipReader(validZip.subarray(0, 10));
    }, /Buffer too small/);

    // Corrupt EOCD signature
    const corruptEocd = Buffer.from(validZip);
    corruptEocd[corruptEocd.length - 22] = 0x00;
    assert.throws(() => {
      new ZipReader(corruptEocd);
    }, /End of Central Directory/);
  });

  test('Adversarial: Decompression bomb allocation threshold guard', () => {
    // Construct central header declaring absurd uncompressed size > 512MB
    const zipData = createZipBuffer([
      { name: 'bomb.txt', data: 'small', method: 0 }
    ]);

    // Mutate uncompressed size in central directory (offset 24 from central header start)
    const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
    // Find central header signature 0x02014b50
    for (let i = 0; i < zipData.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 1073741824, true); // 1 GB
        break;
      }
    }

    const zip = new ZipReader(zipData);
    assert.throws(() => {
      zip.read('bomb.txt');
    }, /exceeds 512MB threshold/);
  });
});
