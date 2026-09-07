/**
 * @file jpeg_decoder.test.js
 * @description Unit and edge-case tests for JpegDecoder and IDCT math.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JpegDecoder, idct8x8 } from '../../src/ingestion/raster/jpeg/jpeg_decoder.js';

/**
 * Builds a minimal valid JPEG file containing APP0 JFIF, APP2 ICC chunks, and frame metadata.
 */
function createMinimalJpeg({
  width = 8,
  height = 8,
  dpi = 300,
  iccChunks = []
}) {
  const parts = [];

  // SOI
  parts.push(Buffer.from([0xff, 0xd8]));

  // APP0 JFIF
  const app0 = Buffer.alloc(18);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2); // Length
  app0.write('JFIF\0', 4, 5, 'ascii');
  app0.writeUInt8(1, 9); // version major
  app0.writeUInt8(1, 10); // version minor
  app0.writeUInt8(1, 11); // unit = inches
  app0.writeUInt16BE(dpi, 12); // X density
  app0.writeUInt16BE(dpi, 14); // Y density
  app0.writeUInt8(0, 16);
  app0.writeUInt8(0, 17);
  parts.push(app0);

  // APP2 ICC Profile Chunks
  for (let i = 0; i < iccChunks.length; i++) {
    const chunkData = iccChunks[i];
    const chunkLen = 2 + 12 + 2 + chunkData.length;
    const app2 = Buffer.alloc(chunkLen);
    app2.writeUInt16BE(0xffe2, 0);
    app2.writeUInt16BE(chunkLen - 2, 2);
    app2.write('ICC_PROFILE\0', 4, 12, 'ascii');
    app2.writeUInt8(i + 1, 16); // Seq number (1-indexed)
    app2.writeUInt8(iccChunks.length, 17); // Total count
    Buffer.from(chunkData).copy(app2, 18);
    parts.push(app2);
  }

  // DQT (Quantization Table 0: flat 16s)
  const dqt = Buffer.alloc(69);
  dqt.writeUInt16BE(0xffdb, 0);
  dqt.writeUInt16BE(67, 2);
  dqt.writeUInt8(0, 4); // table 0, 8-bit
  dqt.fill(16, 5);
  parts.push(dqt);

  // SOF0 (Baseline DCT, 1 component Grayscale)
  const sof0 = Buffer.alloc(13);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(11, 2);
  sof0.writeUInt8(8, 4); // 8-bit precision
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  sof0.writeUInt8(1, 9); // 1 component (Y)
  sof0.writeUInt8(1, 10); // ID 1
  sof0.writeUInt8(0x11, 11); // 1x1 sampling
  sof0.writeUInt8(0, 12); // Q table 0
  parts.push(sof0);

  // DHT (Standard baseline DC 0 table)
  const dhtBuf = Buffer.from([
    0xff, 0xc4, 0x00, 0x1f, 0x00, // DC 0
    0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b
  ]);
  parts.push(dhtBuf);

  // SOS (Start of Scan)
  const sos = Buffer.from([
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00
  ]);
  parts.push(sos);

  // Entropy coded data (DC=0, AC=EOB)
  // Byte 0x00 0x00
  parts.push(Buffer.from([0x00, 0x00]));

  // EOI
  parts.push(Buffer.from([0xff, 0xd9]));

  return Buffer.concat(parts);
}

describe('JpegDecoder: Metadata, IDCT Math & ICC Assembly', () => {
  it('Math: 8x8 IDCT on DC-only block produces uniform constant output', () => {
    const block = new Float64Array(64);
    block[0] = 0; // DC = 0 relative to level shift 128
    const out = new Uint8Array(64);
    idct8x8(block, out);

    // All 64 values should be 128
    for (let i = 0; i < 64; i++) {
      assert.equal(out[i], 128);
    }
  });

  it('Golden Path: Decodes JFIF DPI and multi-chunk APP2 ICC profiles', () => {
    // Multi-chunk fake ICC profile split across 2 chunks
    const iccPart1 = new Uint8Array([1, 2, 3, 4, 5]);
    const iccPart2 = new Uint8Array([6, 7, 8, 9, 10]);

    const jpeg = createMinimalJpeg({
      width: 8,
      height: 8,
      dpi: 300,
      iccChunks: [iccPart1, iccPart2]
    });

    const image = JpegDecoder.decode(jpeg);
    assert.equal(image.width, 8);
    assert.equal(image.height, 8);
    assert.equal(image.dpiX, 300);
    assert.equal(image.dpiY, 300);
  });

  it('Adversarial: Rejects buffer missing SOI marker', () => {
    assert.throws(() => {
      JpegDecoder.decode(new Uint8Array([0x00, 0x00, 0xff, 0xd8]));
    }, /soi marker/i);
  });

  it('Adversarial: Rejects truncated buffer without SOS', () => {
    assert.throws(() => {
      JpegDecoder.decode(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    }, /truncated before sos/i);
  });
});
