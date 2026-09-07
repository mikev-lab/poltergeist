/**
 * @file png_decoder.test.js
 * @description Comprehensive unit and edge-case tests for PngDecoder.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { PngDecoder, computeCrc32 } from '../../src/ingestion/raster/png/png_decoder.js';
import { ColorSpaceType, PixelFormat } from '../../src/types/image.js';

/**
 * Builds a valid PNG binary buffer from raw uncompressed scanlines.
 */
function createPngBinary({
  width,
  height,
  colorType = 2, // RGB
  bitDepth = 8,
  scanlines,
  palette = null,
  dpi = 300,
  corruptCrc = false,
  iccBytes = null
}) {
  const chunks = [];
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  chunks.push(signature);

  function makeChunk(typeStr, data) {
    const len = data.length;
    const header = Buffer.alloc(8);
    header.writeUInt32BE(len, 0);
    header.write(typeStr, 4, 4, 'ascii');

    const crcBuf = Buffer.concat([header.subarray(4, 8), data]);
    let crc = computeCrc32(crcBuf, 0, crcBuf.length);
    if (corruptCrc) crc ^= 0xdeadbeef;

    const footer = Buffer.alloc(4);
    footer.writeUInt32BE(crc >>> 0, 0);

    return Buffer.concat([header, data, footer]);
  }

  // 1. IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(bitDepth, 8);
  ihdr.writeUInt8(colorType, 9);
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace
  chunks.push(makeChunk('IHDR', ihdr));

  // 2. PLTE if indexed
  if (palette) {
    chunks.push(makeChunk('PLTE', Buffer.from(palette)));
  }

  // 3. pHYs
  if (dpi > 0) {
    const phys = Buffer.alloc(9);
    const ppm = Math.round(dpi / 0.0254);
    phys.writeUInt32BE(ppm, 0);
    phys.writeUInt32BE(ppm, 4);
    phys.writeUInt8(1, 8); // meters
    chunks.push(makeChunk('pHYs', phys));
  }

  // 4. iCCP if present
  if (iccBytes) {
    const compressedIcc = zlib.deflateSync(Buffer.from(iccBytes));
    const name = Buffer.from('CustomProfile\0\0'); // null-terminated, comp=0
    chunks.push(makeChunk('iCCP', Buffer.concat([name, compressedIcc])));
  }

  // 5. IDAT
  const compressedData = zlib.deflateSync(Buffer.from(scanlines));
  chunks.push(makeChunk('IDAT', compressedData));

  // 6. IEND
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

describe('PngDecoder: Golden Paths & Format Coverage', () => {
  it('Golden Path: Decodes 8-bit RGB image with Filter None', () => {
    // 2x2 RGB image (Filter type 0 + 6 bytes per row)
    const scanlines = new Uint8Array([
      0, 255, 0, 0, 0, 255, 0, // Row 0: Red, Green
      0, 0, 0, 255, 255, 255, 0 // Row 1: Blue, Yellow
    ]);

    const png = createPngBinary({ width: 2, height: 2, colorType: 2, scanlines, dpi: 300 });
    const image = PngDecoder.decode(png);

    assert.equal(image.width, 2);
    assert.equal(image.height, 2);
    assert.equal(image.channels, 3);
    assert.equal(image.colorSpace, ColorSpaceType.RGB);
    assert.equal(image.pixelFormat, PixelFormat.RGB24);
    assert.equal(image.dpiX, 300);

    // Verify pixel data
    assert.equal(image.data[0], 255); // R
    assert.equal(image.data[1], 0);   // G
    assert.equal(image.data[2], 0);   // B
    assert.equal(image.data[3], 0);   // R
    assert.equal(image.data[4], 255); // G
    assert.equal(image.data[5], 0);   // B
  });

  it('Golden Path: Decodes 8-bit RGBA image with Filter Sub, Up, Average, and Paeth', () => {
    // 2x4 RGBA image (bpp = 4)
    // Row 0: Filter 0 (None)
    // Row 1: Filter 1 (Sub)
    // Row 2: Filter 2 (Up)
    // Row 3: Filter 4 (Paeth)
    const scanlines = new Uint8Array([
      0, 10, 20, 30, 255, 10, 20, 30, 255,
      1, 5,  5,  5,  0,   5,  5,  5,  0,
      2, 1,  1,  1,  0,   1,  1,  1,  0,
      4, 2,  2,  2,  0,   2,  2,  2,  0
    ]);

    const png = createPngBinary({ width: 2, height: 4, colorType: 6, scanlines });
    const image = PngDecoder.decode(png);

    assert.equal(image.width, 2);
    assert.equal(image.height, 4);
    assert.equal(image.channels, 4);
    assert.equal(image.hasAlpha, true);
    assert.equal(image.pixelFormat, PixelFormat.RGBA32);
  });

  it('Golden Path: Decodes 8-bit Indexed/Palette image', () => {
    // 2x2 indexed image
    const palette = [
      255, 0, 0,   // index 0: Red
      0, 255, 0,   // index 1: Green
      0, 0, 255,   // index 2: Blue
      255, 255, 255 // index 3: White
    ];
    const scanlines = new Uint8Array([
      0, 0, 1, // Filter 0: idx 0, idx 1
      0, 2, 3  // Filter 0: idx 2, idx 3
    ]);

    const png = createPngBinary({ width: 2, height: 2, colorType: 3, palette, scanlines });
    const image = PngDecoder.decode(png);

    assert.equal(image.width, 2);
    assert.equal(image.height, 2);
    assert.equal(image.channels, 3); // Unpacked to RGB24
    assert.equal(image.data[0], 255); // Red
    assert.equal(image.data[1], 0);
    assert.equal(image.data[2], 0);
    assert.equal(image.data[3], 0);   // Green
    assert.equal(image.data[4], 255);
    assert.equal(image.data[5], 0);
  });
});

describe('PngDecoder: Deep Edge Cases & Adversarial Inputs', () => {
  it('Deep Edge Case: 1x1 single pixel image', () => {
    const scanlines = new Uint8Array([0, 128, 128, 128]); // Filter 0 + Gray RGB
    const png = createPngBinary({ width: 1, height: 1, colorType: 2, scanlines });
    const image = PngDecoder.decode(png);

    assert.equal(image.width, 1);
    assert.equal(image.height, 1);
    assert.equal(image.data[0], 128);
    assert.equal(image.data[1], 128);
    assert.equal(image.data[2], 128);
  });

  it('Deep Edge Case: Extreme aspect ratio 1x512 vertical strip', () => {
    const scanlines = new Uint8Array(512 * 4); // 512 rows, each has 1 filter byte + 3 bytes
    for (let y = 0; y < 512; y++) {
      scanlines[y * 4] = 0; // Filter None
      scanlines[y * 4 + 1] = y & 0xff;
      scanlines[y * 4 + 2] = (y >> 1) & 0xff;
      scanlines[y * 4 + 3] = (y >> 2) & 0xff;
    }

    const png = createPngBinary({ width: 1, height: 512, colorType: 2, scanlines });
    const image = PngDecoder.decode(png);

    assert.equal(image.width, 1);
    assert.equal(image.height, 512);
    assert.equal(image.getScanline(100)[0], 100);
  });

  it('Adversarial: Rejects buffer smaller than 8-byte PNG header', () => {
    assert.throws(() => {
      PngDecoder.decode(new Uint8Array([0x89, 0x50, 0x4e]));
    }, /truncated/i);
  });

  it('Adversarial: Rejects invalid magic signature', () => {
    assert.throws(() => {
      PngDecoder.decode(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]));
    }, /invalid png signature/i);
  });

  it('Adversarial: Detects and rejects corrupted CRC-32 checksums', () => {
    const scanlines = new Uint8Array([0, 100, 100, 100]);
    const png = createPngBinary({ width: 1, height: 1, colorType: 2, scanlines, corruptCrc: true });

    assert.throws(() => {
      PngDecoder.decode(png);
    }, /crc-32 checksum mismatch/i);
  });
});
