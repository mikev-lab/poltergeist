/**
 * @file generator.js
 * @description Programmatic generator for adversarial, corrupt, and fuzzing fixtures in Poltergeist.
 * Strictly zero-dependency and memory-safe.
 */

import zlib from 'node:zlib';

/**
 * Generates an array of truncated versions of a valid binary buffer.
 * Slices at byte offsets 0, 1, 2, 4, 8, 16, 32, and mid-stream.
 * @param {Uint8Array|Buffer} buffer
 * @returns {Uint8Array[]}
 */
export function createTruncatedStreams(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const cuts = [0, 1, 2, 4, 8, 16, 32, Math.floor(bytes.length / 2), Math.max(0, bytes.length - 1)];
  const results = [];
  for (const cut of cuts) {
    if (cut <= bytes.length) {
      results.push(bytes.slice(0, cut));
    }
  }
  return results;
}

/**
 * Generates a ZIP archive containing a Zip-Slip path traversal vulnerability attempt.
 * @param {string} maliciousName e.g. '../../evil.txt'
 * @returns {Buffer}
 */
export function createZipSlipArchive(maliciousName = '../../evil.txt') {
  const nameBuf = Buffer.from(maliciousName, 'utf8');
  const dataBuf = Buffer.from('malicious payload', 'utf8');

  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8); // Stored
  localHeader.writeUInt32LE(dataBuf.length, 18);
  localHeader.writeUInt32LE(dataBuf.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(localHeader, 30);

  const localOffset = 0;
  const centralHeader = Buffer.alloc(46 + nameBuf.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(dataBuf.length, 20);
  centralHeader.writeUInt32LE(dataBuf.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt32LE(localOffset, 42);
  nameBuf.copy(centralHeader, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralHeader.length, 12);
  eocd.writeUInt32LE(localHeader.length + dataBuf.length, 16);

  return Buffer.concat([localHeader, dataBuf, centralHeader, eocd]);
}

/**
 * Generates a ZIP archive containing an extreme decompression bomb.
 * Claims a 1 GB uncompressed size for a tiny Deflate stream.
 * @returns {Buffer}
 */
export function createDecompressionBombArchive() {
  const nameBuf = Buffer.from('bomb.txt', 'utf8');
  // 100 KB of zeros deflated to ~100 bytes
  const uncompLen = 1024 * 1024 * 600; // 600 MB (exceeds 512 MB threshold)
  const tinyDeflate = zlib.deflateRawSync(Buffer.alloc(4096)); // small valid deflate stream

  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8); // Deflate
  localHeader.writeUInt32LE(tinyDeflate.length, 18);
  localHeader.writeUInt32LE(uncompLen, 22); // Claims 600 MB
  localHeader.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(localHeader, 30);

  const localOffset = 0;
  const centralHeader = Buffer.alloc(46 + nameBuf.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt32LE(tinyDeflate.length, 20);
  centralHeader.writeUInt32LE(uncompLen, 24); // Claims 600 MB in central directory
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt32LE(localOffset, 42);
  nameBuf.copy(centralHeader, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralHeader.length, 12);
  eocd.writeUInt32LE(localHeader.length + tinyDeflate.length, 16);

  return Buffer.concat([localHeader, tinyDeflate, centralHeader, eocd]);
}

/**
 * Generates an image header declaring an absurd dimension to test integer overflow guards.
 * @param {'BMP'|'PNG'|'PSD'} format
 * @returns {Buffer}
 */
export function createIntegerOverflowHeader(format) {
  if (format === 'BMP') {
    const buf = Buffer.alloc(54);
    buf[0] = 0x42; buf[1] = 0x4D;
    buf.writeUInt32LE(54, 2);
    buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(65535, 18); // Width = 65535
    buf.writeInt32LE(65535, 22); // Height = 65535
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(32, 28); // 32-bit: 65535 * 65535 * 4 = ~17 GB
    return buf;
  }

  if (format === 'PSD') {
    const buf = Buffer.alloc(26);
    buf.write('8BPS', 0, 'latin1');
    buf.writeUInt16BE(1, 4); // Version 1
    buf.writeUInt16BE(4, 12); // 4 channels
    buf.writeUInt32BE(65535, 14); // Height = 65535
    buf.writeUInt32BE(65535, 18); // Width = 65535
    buf.writeUInt16BE(16, 22); // 16-bit
    buf.writeUInt16BE(3, 24); // RGB
    return buf;
  }

  // PNG with IHDR claiming huge dimensions
  const buf = Buffer.alloc(33);
  buf.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
  buf.writeUInt32BE(13, 8); // IHDR length
  buf.write('IHDR', 12, 'latin1');
  buf.writeUInt32BE(65535, 16); // Width
  buf.writeUInt32BE(65535, 20); // Height
  buf[24] = 8; // bit depth
  buf[25] = 6; // RGBA
  return buf;
}

/**
 * Generates a corrupted PDF with damaged xref table (negative offsets or invalid tokens).
 * @returns {Buffer}
 */
export function createCorruptedPdfXref() {
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
xref
GARBAGE_XREF_NOT_NUMBERS
trailer << /Size 4 /Root 1 0 R >>
startxref
99999999
%%EOF`;
  return Buffer.from(content, 'latin1');
}
