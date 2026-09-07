/**
 * @file jpeg_export.test.js
 * @description Unit, compliance, and edge case tests for pure native JpegWriter export module.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JpegWriter } from '../../src/export/jpeg/jpeg_writer.js';
import { JpegDecoder } from '../../src/ingestion/raster/jpeg/jpeg_decoder.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../src/types/image.js';
import { convert, ExportFormat } from '../../src/pipeline/convert.js';

describe('JpegWriter: Baseline JPEG Serialization & Standards Compliance', () => {
  it('Golden Path: Encodes RGB24 image with valid SOI, JFIF APP0, SOF0, SOS, and EOI markers', () => {
    const width = 64;
    const height = 48;
    const data = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      data[i * 3] = (i % 256);
      data[i * 3 + 1] = ((i * 2) % 256);
      data[i * 3 + 2] = 200;
    }

    const image = new RasterImage({
      width,
      height,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      dpiX: 72,
      dpiY: 72,
      data
    });

    const jpegBytes = JpegWriter.write(image, { quality: 85, dpiX: 72, dpiY: 72 });
    assert.ok(jpegBytes instanceof Uint8Array);
    assert.ok(jpegBytes.length > 100);

    // SOI (0xFF 0xD8)
    assert.strictEqual(jpegBytes[0], 0xFF);
    assert.strictEqual(jpegBytes[1], 0xD8);

    // APP0 (0xFF 0xE0)
    assert.strictEqual(jpegBytes[2], 0xFF);
    assert.strictEqual(jpegBytes[3], 0xE0);

    // JFIF tag: "JFIF\0"
    const jfifTag = String.fromCharCode(...jpegBytes.subarray(6, 11));
    assert.strictEqual(jfifTag, 'JFIF\0');

    // Density units = 1 (dots per inch)
    assert.strictEqual(jpegBytes[13], 1);
    // Xdensity = 72, Ydensity = 72
    const xDensity = (jpegBytes[14] << 8) | jpegBytes[15];
    const yDensity = (jpegBytes[16] << 8) | jpegBytes[17];
    assert.strictEqual(xDensity, 72);
    assert.strictEqual(yDensity, 72);

    // EOI (0xFF 0xD9) at end
    assert.strictEqual(jpegBytes[jpegBytes.length - 2], 0xFF);
    assert.strictEqual(jpegBytes[jpegBytes.length - 1], 0xD9);
  });

  it('Roundtrip: Decodes encoded RGB24 JPEG with JpegDecoder', () => {
    const width = 32;
    const height = 32;
    const data = new Uint8Array(width * height * 3);
    data.fill(128); // flat neutral gray

    const image = new RasterImage({
      width,
      height,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      dpiX: 72,
      dpiY: 72,
      data
    });

    const jpegBytes = JpegWriter.write(image, { quality: 90, dpiX: 72, dpiY: 72 });
    const decoded = JpegDecoder.decode(jpegBytes);

    assert.strictEqual(decoded.width, 32);
    assert.strictEqual(decoded.height, 32);
    assert.strictEqual(decoded.colorSpace, ColorSpaceType.RGB);
    assert.strictEqual(decoded.dpiX, 72);
    assert.strictEqual(decoded.dpiY, 72);
    // Gray should be preserved within quantization tolerance (±5)
    assert.ok(Math.abs(decoded.data[0] - 128) < 5);
    assert.ok(Math.abs(decoded.data[1] - 128) < 5);
    assert.ok(Math.abs(decoded.data[2] - 128) < 5);
  });

  it('Grayscale: Encodes 1-channel grayscale image and decodes back', () => {
    const width = 40;
    const height = 40;
    const data = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      data[i] = (i % 256);
    }

    const image = new RasterImage({
      width,
      height,
      channels: 1,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.GRAY,
      pixelFormat: PixelFormat.GRAY8,
      dpiX: 150,
      dpiY: 150,
      data
    });

    const jpegBytes = JpegWriter.write(image, { quality: 80, dpiX: 150, dpiY: 150 });
    assert.strictEqual(jpegBytes[0], 0xFF);
    assert.strictEqual(jpegBytes[1], 0xD8);

    const decoded = JpegDecoder.decode(jpegBytes);
    assert.strictEqual(decoded.width, 40);
    assert.strictEqual(decoded.height, 40);
  });

  it('Edge Case: Handles non-multiple-of-8 dimensions with block edge-padding', () => {
    const width = 17;
    const height = 23;
    const data = new Uint8Array(width * height * 3);
    data.fill(200);

    const image = new RasterImage({
      width,
      height,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      data
    });

    const jpegBytes = JpegWriter.write(image);
    const decoded = JpegDecoder.decode(jpegBytes);

    assert.strictEqual(decoded.width, 17);
    assert.strictEqual(decoded.height, 23);
  });

  it('Edge Case: Single-pixel 1x1 boundary image', () => {
    const data = new Uint8Array([255, 0, 128]);
    const image = new RasterImage({
      width: 1,
      height: 1,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      data
    });

    const jpegBytes = JpegWriter.write(image, { quality: 95 });
    const decoded = JpegDecoder.decode(jpegBytes);

    assert.strictEqual(decoded.width, 1);
    assert.strictEqual(decoded.height, 1);
  });

  it('Quality Scaling: High quality produces larger payload than low quality', () => {
    const width = 64;
    const height = 64;
    const data = new Uint8Array(width * height * 3);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 37) % 256;
    }

    const image = new RasterImage({
      width,
      height,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      data
    });

    const lowQ = JpegWriter.write(image, { quality: 15 });
    const highQ = JpegWriter.write(image, { quality: 95 });

    assert.ok(highQ.length > lowQ.length * 1.5, `highQ (${highQ.length}) should be larger than lowQ (${lowQ.length})`);
  });

  it('Adversarial & Validation: Rejects invalid inputs gracefully', () => {
    assert.throws(() => JpegWriter.write(null), /invalid raster image/i);
    assert.throws(() => JpegWriter.write({}), /invalid raster image/i);
  });

  it('Pipeline Integration: convert() exports directly to JPEG with DPI downsampling', () => {
    const width = 100;
    const height = 100;
    const data = new Uint8Array(width * height * 3).fill(100);

    const image = new RasterImage({
      width,
      height,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      dpiX: 300,
      dpiY: 300,
      data
    });

    const result = convert(image, { format: 'jpg', targetDpi: 72 });
    assert.ok(result instanceof Uint8Array);
    assert.strictEqual(result[0], 0xFF);
    assert.strictEqual(result[1], 0xD8);

    const decoded = JpegDecoder.decode(result);
    assert.strictEqual(decoded.dpiX, 72);
    assert.strictEqual(decoded.dpiY, 72);
    // 100 * (72 / 300) = 24
    assert.strictEqual(decoded.width, 24);
    assert.strictEqual(decoded.height, 24);
  });
});
