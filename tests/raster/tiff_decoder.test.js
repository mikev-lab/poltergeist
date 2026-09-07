/**
 * @file tiff_decoder.test.js
 * @description Unit and edge-case test suite for TiffDecoder and TiffWriter.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { TiffDecoder, decompressPackBits } from '../../src/ingestion/raster/tiff/tiff_decoder.js';
import { TiffWriter } from '../../src/export/tiff/tiff_writer.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../src/types/image.js';

describe('TiffDecoder: Golden Paths & Compressions', () => {
  it('Golden Path: Decodes Little-Endian CMYK 8-bit TIFF (Deflate compressed)', () => {
    // 2x2 CMYK image
    const cmykData = new Uint8Array([
      255, 0, 0, 0,    // Cyan
      0, 255, 0, 0,    // Magenta
      0, 0, 255, 0,    // Yellow
      0, 0, 0, 255     // Black
    ]);

    const sourceImage = new RasterImage({
      width: 2,
      height: 2,
      channels: 4,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.CMYK,
      pixelFormat: PixelFormat.CMYK32,
      dpiX: 300,
      dpiY: 300,
      data: cmykData
    });

    const tiffBytes = TiffWriter.write(sourceImage, { compress: true });
    const decoded = TiffDecoder.decode(tiffBytes);

    assert.equal(decoded.width, 2);
    assert.equal(decoded.height, 2);
    assert.equal(decoded.channels, 4);
    assert.equal(decoded.colorSpace, ColorSpaceType.CMYK);
    assert.equal(decoded.pixelFormat, PixelFormat.CMYK32);
    assert.equal(decoded.dpiX, 300);

    // Verify channel contents
    assert.equal(decoded.data[0], 255); // C
    assert.equal(decoded.data[1], 0);   // M
    assert.equal(decoded.data[5], 255); // M in pixel 1
    assert.equal(decoded.data[10], 255); // Y in pixel 2
    assert.equal(decoded.data[15], 255); // K in pixel 3
  });

  it('Golden Path: Decodes Uncompressed RGB 8-bit TIFF', () => {
    const rgbData = new Uint8Array([
      255, 128, 64,
      10, 20, 30
    ]);

    const sourceImage = new RasterImage({
      width: 2,
      height: 1,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      data: rgbData
    });

    const tiffBytes = TiffWriter.write(sourceImage, { compress: false });
    const decoded = TiffDecoder.decode(tiffBytes);

    assert.equal(decoded.width, 2);
    assert.equal(decoded.height, 1);
    assert.equal(decoded.channels, 3);
    assert.equal(decoded.colorSpace, ColorSpaceType.RGB);
    assert.equal(decoded.data[0], 255);
    assert.equal(decoded.data[1], 128);
    assert.equal(decoded.data[2], 64);
  });

  it('Golden Path: Decodes PackBits compression scheme', () => {
    // Literal 3 bytes (n=2), followed by run of 4 bytes of 0xAA (n=-3)
    const packBitsCompressed = new Uint8Array([
      2, 10, 20, 30,    // literal 10, 20, 30
      0xfd, 0xaa        // -3 -> repeat 0xAA 4 times
    ]);
    const decompressed = decompressPackBits(packBitsCompressed, 7);

    assert.deepEqual(decompressed, new Uint8Array([10, 20, 30, 0xaa, 0xaa, 0xaa, 0xaa]));
  });
});

describe('TiffDecoder: Deep Edge Cases & Corrupt Streams', () => {
  it('Deep Edge Case: 1x1 pixel CMYK image round-trip', () => {
    const data = new Uint8Array([100, 150, 200, 250]);
    const sourceImage = new RasterImage({
      width: 1,
      height: 1,
      channels: 4,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.CMYK,
      pixelFormat: PixelFormat.CMYK32,
      data
    });

    const tiffBytes = TiffWriter.write(sourceImage);
    const decoded = TiffDecoder.decode(tiffBytes);

    assert.equal(decoded.width, 1);
    assert.equal(decoded.height, 1);
    assert.equal(decoded.data[0], 100);
    assert.equal(decoded.data[1], 150);
    assert.equal(decoded.data[2], 200);
    assert.equal(decoded.data[3], 250);
  });

  it('Adversarial: Rejects truncated buffer under 8 bytes', () => {
    assert.throws(() => {
      TiffDecoder.decode(new Uint8Array([0x49, 0x49, 0x2a]));
    }, /truncated/i);
  });

  it('Adversarial: Rejects invalid endianness indicators', () => {
    assert.throws(() => {
      TiffDecoder.decode(new Uint8Array([0x58, 0x58, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]));
    }, /invalid tiff byte order/i);
  });

  it('Adversarial: Rejects invalid magic number', () => {
    assert.throws(() => {
      TiffDecoder.decode(new Uint8Array([0x49, 0x49, 0x99, 0x99, 0x00, 0x00, 0x00, 0x08]));
    }, /invalid tiff magic number/i);
  });
});
