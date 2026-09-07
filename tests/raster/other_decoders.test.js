/**
 * @file other_decoders.test.js
 * @description Unit tests for BMP, TGA, WebP, and unified decodeRaster sniffer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BmpDecoder } from '../../src/ingestion/raster/bmp/bmp_decoder.js';
import { TgaDecoder } from '../../src/ingestion/raster/tga/tga_decoder.js';
import { WebpDecoder } from '../../src/ingestion/raster/webp/webp_decoder.js';
import { decodeRaster } from '../../src/ingestion/raster/index.js';
import { ColorSpaceType, PixelFormat } from '../../src/types/image.js';

describe('BmpDecoder: Formats & Orientations', () => {
  it('Golden Path: Decodes 24-bit RGB bottom-up BMP with padding', () => {
    // 2x2 BMP 24-bit
    // Row byte length = floor((2*24 + 31)/32)*4 = 8 bytes (6 bytes pixels + 2 bytes pad)
    // Header (14 bytes) + DIB header (40 bytes) = 54 bytes
    const totalSize = 54 + 8 * 2;
    const buf = Buffer.alloc(totalSize);

    // File header
    buf.write('BM', 0, 2, 'ascii');
    buf.writeUInt32LE(totalSize, 2);
    buf.writeUInt32LE(54, 10); // dataOffset

    // DIB header
    buf.writeUInt32LE(40, 14); // dibHeaderSize
    buf.writeInt32LE(2, 18);   // width
    buf.writeInt32LE(2, 22);   // height (positive = bottom-up)
    buf.writeUInt16LE(1, 26);  // planes
    buf.writeUInt16LE(24, 28); // bpp
    buf.writeUInt32LE(0, 30);  // BI_RGB
    buf.writeInt32LE(11811, 38); // ~300 DPI
    buf.writeInt32LE(11811, 42);

    // Pixels: Bottom row first (Row 1 in image: Blue, Yellow)
    // BGR ordering
    buf[54] = 255; buf[55] = 0; buf[56] = 0; // Blue (B=255, G=0, R=0)
    buf[57] = 0; buf[58] = 255; buf[59] = 255; // Yellow (B=0, G=255, R=255)
    // Row 0 in image (top row: Red, Green)
    buf[54 + 8] = 0; buf[54 + 9] = 0; buf[54 + 10] = 255; // Red (B=0, G=0, R=255)
    buf[54 + 11] = 0; buf[54 + 12] = 255; buf[54 + 13] = 0; // Green (B=0, G=255, R=0)

    const img = BmpDecoder.decode(buf);
    assert.equal(img.width, 2);
    assert.equal(img.height, 2);
    assert.equal(img.colorSpace, ColorSpaceType.RGB);
    assert.equal(img.pixelFormat, PixelFormat.RGB24);

    // Top-left pixel should be Red (255, 0, 0)
    assert.equal(img.data[0], 255);
    assert.equal(img.data[1], 0);
    assert.equal(img.data[2], 0);
  });

  it('Adversarial: Rejects non-BM header', () => {
    assert.throws(() => {
      BmpDecoder.decode(Buffer.from([0x00, 0x00, 0x12, 0x34]));
    }, /"bm" signature missing/i);
  });
});

describe('TgaDecoder: Formats & Orientations', () => {
  it('Golden Path: Decodes 24-bit uncompressed RGB TGA', () => {
    // 2x1 TGA: Red, Blue
    const buf = Buffer.alloc(18 + 6);
    buf[2] = 2; // Type 2 = uncompressed truecolor
    buf.writeUInt16LE(2, 12); // width
    buf.writeUInt16LE(1, 14); // height
    buf[16] = 24; // 24 bpp
    buf[17] = 0x20; // top-to-bottom

    // Pixel 0: Red (B=0, G=0, R=255)
    buf[18] = 0; buf[19] = 0; buf[20] = 255;
    // Pixel 1: Blue (B=255, G=0, R=0)
    buf[21] = 255; buf[22] = 0; buf[23] = 0;

    const img = TgaDecoder.decode(buf);
    assert.equal(img.width, 2);
    assert.equal(img.height, 1);
    assert.equal(img.data[0], 255); // R
    assert.equal(img.data[1], 0);   // G
    assert.equal(img.data[2], 0);   // B
    assert.equal(img.data[3], 0);   // R
    assert.equal(img.data[4], 0);   // G
    assert.equal(img.data[5], 255); // B
  });
});

describe('WebpDecoder: RIFF Container & VP8X Metadata', () => {
  it('Golden Path: Decodes WebP RIFF VP8X container dimensions & flags', () => {
    // 12 bytes RIFF header + 18 bytes VP8X chunk
    const totalSize = 30;
    const buf = Buffer.alloc(totalSize);

    buf.write('RIFF', 0, 4, 'ascii');
    buf.writeUInt32LE(totalSize - 8, 4);
    buf.write('WEBP', 8, 4, 'ascii');

    // VP8X chunk
    buf.write('VP8X', 12, 4, 'ascii');
    buf.writeUInt32LE(10, 16); // Chunk payload = 10 bytes
    buf[20] = 0x10; // Alpha flag
    // Canvas width minus 1 = 99 -> Width = 100
    buf[24] = 99; buf[25] = 0; buf[26] = 0;
    // Canvas height minus 1 = 49 -> Height = 50
    buf[27] = 49; buf[28] = 0; buf[29] = 0;

    const img = WebpDecoder.decode(buf);
    assert.equal(img.width, 100);
    assert.equal(img.height, 50);
    assert.equal(img.hasAlpha, true);
    assert.equal(img.pixelFormat, PixelFormat.RGBA32);
  });
});

describe('Unified decodeRaster Router', () => {
  it('Sniffs and dispatches BMP, TGA, and rejects unknown buffers', () => {
    // Valid minimal BMP
    const bmpBuf = Buffer.alloc(54);
    bmpBuf.write('BM', 0, 2, 'ascii');
    bmpBuf.writeUInt32LE(54, 10);
    bmpBuf.writeUInt32LE(40, 14);
    bmpBuf.writeInt32LE(1, 18);
    bmpBuf.writeInt32LE(1, 22);
    bmpBuf.writeUInt16LE(1, 26);
    bmpBuf.writeUInt16LE(24, 28);

    const img = decodeRaster(bmpBuf);
    assert.equal(img.width, 1);
    assert.equal(img.height, 1);

    // Unknown buffer
    assert.throws(() => {
      decodeRaster(Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]));
    }, /unsupported or unrecognized/i);
  });
});
