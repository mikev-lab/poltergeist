/**
 * @file jpeg_scaled_idct.test.js
 * @description Comprehensive unit tests for Scaled IDCT (1, 1/2, 1/4, 1/8) in JpegDecoder.
 * Tests golden paths, dimension calculation, grayscale, RGB, and numerical stability.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JpegDecoder } from '../../src/ingestion/raster/jpeg/jpeg_decoder.js';
import { JpegWriter } from '../../src/export/jpeg/jpeg_writer.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../src/types/image.js';
import { fastIdct8x8, idct4x4, idct2x2, idct1x1 } from '../../src/ingestion/raster/jpeg/idct_wasm.js';

describe('JPEG Scaled IDCT Micro-Kernels', () => {
  it('computes 8x8 IDCT on DC-only block', () => {
    const block = new Float64Array(64);
    block[0] = 800; // DC level
    const out = new Uint8Array(64);
    fastIdct8x8(block, out);

    // block[0] * C[0][0] * C[0][0] = 800 * (0.5 * 0.7071)^2 = 800 / 8 = 100
    // Level shift +128 = 228
    for (let i = 0; i < 64; i++) {
      assert.strictEqual(out[i], 228);
    }
  });

  it('computes 4x4 IDCT (1/2 scale) on DC-only block', () => {
    const block = new Float64Array(64);
    block[0] = 800;
    const out = new Uint8Array(16);
    idct4x4(block, out);

    for (let i = 0; i < 16; i++) {
      assert.strictEqual(out[i], 228);
    }
  });

  it('computes 2x2 IDCT (1/4 scale) on DC-only block', () => {
    const block = new Float64Array(64);
    block[0] = 800;
    const out = new Uint8Array(4);
    idct2x2(block, out);

    for (let i = 0; i < 4; i++) {
      assert.strictEqual(out[i], 228);
    }
  });

  it('computes 1x1 IDCT (1/8 scale) on DC-only block', () => {
    const block = new Float64Array(64);
    block[0] = 800;
    const out = new Uint8Array(1);
    idct1x1(block, out);

    assert.strictEqual(out[0], 228);
  });
});

describe('JpegDecoder Scaled IDCT Ingestion', () => {
  // Helper to create a test JPEG image
  function makeTestJpeg(width, height, isGray = false) {
    const channels = isGray ? 1 : 3;
    const data = new Uint8Array(width * height * channels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * channels;
        if (isGray) {
          data[idx] = (x + y) % 256;
        } else {
          data[idx] = (x * 7) % 256;     // R
          data[idx + 1] = (y * 5) % 256; // G
          data[idx + 2] = 180;           // B
        }
      }
    }
    const raster = new RasterImage({
      width,
      height,
      channels,
      bitsPerSample: 8,
      colorSpace: isGray ? ColorSpaceType.GRAY : ColorSpaceType.RGB,
      pixelFormat: isGray ? PixelFormat.GRAY8 : PixelFormat.RGB24,
      dpiX: 300,
      dpiY: 300,
      data
    });
    return JpegWriter.write(raster, { quality: 85, dpiX: 300, dpiY: 300 });
  }

  it('decodes RGB JPEG at 1/1, 1/2, 1/4, and 1/8 resolutions', () => {
    const origW = 64;
    const origH = 48;
    const jpegBytes = makeTestJpeg(origW, origH, false);

    // 1/1 full resolution
    const img1 = JpegDecoder.decode(jpegBytes, { scaleDenom: 1 });
    assert.strictEqual(img1.width, 64);
    assert.strictEqual(img1.height, 48);
    assert.strictEqual(img1.channels, 3);
    assert.strictEqual(img1.dpiX, 300);

    // 1/2 resolution (4x4 IDCT)
    const img2 = JpegDecoder.decode(jpegBytes, { scaleDenom: 2 });
    assert.strictEqual(img2.width, 32);
    assert.strictEqual(img2.height, 24);
    assert.strictEqual(img2.channels, 3);
    assert.strictEqual(img2.dpiX, 150);

    // 1/4 resolution (2x2 IDCT)
    const img4 = JpegDecoder.decode(jpegBytes, { scaleDenom: 4 });
    assert.strictEqual(img4.width, 16);
    assert.strictEqual(img4.height, 12);
    assert.strictEqual(img4.channels, 3);
    assert.strictEqual(img4.dpiX, 75);

    // 1/8 resolution (1x1 IDCT)
    const img8 = JpegDecoder.decode(jpegBytes, { scaleDenom: 8 });
    assert.strictEqual(img8.width, 8);
    assert.strictEqual(img8.height, 6);
    assert.strictEqual(img8.channels, 3);
    assert.strictEqual(img8.dpiX, 38);
  });

  it('preserves mean luminance across scaled resolutions', () => {
    const origW = 32;
    const origH = 32;
    const jpegBytes = makeTestJpeg(origW, origH, false);

    const img1 = JpegDecoder.decode(jpegBytes, { scaleDenom: 1 });
    const img2 = JpegDecoder.decode(jpegBytes, { scaleDenom: 2 });
    const img4 = JpegDecoder.decode(jpegBytes, { scaleDenom: 4 });

    function meanColor(img) {
      let r = 0, g = 0, b = 0;
      const total = img.width * img.height;
      for (let i = 0; i < total; i++) {
        r += img.data[i * 3];
        g += img.data[i * 3 + 1];
        b += img.data[i * 3 + 2];
      }
      return [r / total, g / total, b / total];
    }

    const [r1, g1, b1] = meanColor(img1);
    const [r2, g2, b2] = meanColor(img2);
    const [r4, g4, b4] = meanColor(img4);

    // Check that mean values are well preserved across scales (within 5 levels)
    assert.ok(Math.abs(r1 - r2) < 5.0, `R channel delta between 1x and 1/2x: ${Math.abs(r1 - r2)}`);
    assert.ok(Math.abs(g1 - g2) < 5.0, `G channel delta between 1x and 1/2x: ${Math.abs(g1 - g2)}`);
    assert.ok(Math.abs(b1 - b2) < 5.0, `B channel delta between 1x and 1/2x: ${Math.abs(b1 - b2)}`);

    assert.ok(Math.abs(r1 - r4) < 7.0, `R channel delta between 1x and 1/4x: ${Math.abs(r1 - r4)}`);
    assert.ok(Math.abs(g1 - g4) < 7.0, `G channel delta between 1x and 1/4x: ${Math.abs(g1 - g4)}`);
    assert.ok(Math.abs(b1 - b4) < 7.0, `B channel delta between 1x and 1/4x: ${Math.abs(b1 - b4)}`);
  });

  it('decodes grayscale JPEG at scaled resolutions', () => {
    const origW = 32;
    const origH = 32;
    const jpegBytes = makeTestJpeg(origW, origH, true);

    const img4 = JpegDecoder.decode(jpegBytes, { scaleDenom: 4 });
    assert.strictEqual(img4.width, 8);
    assert.strictEqual(img4.height, 8);
    assert.strictEqual(img4.channels, 1);
    assert.strictEqual(img4.colorSpace, ColorSpaceType.GRAY);
    assert.strictEqual(img4.data.length, 64);
  });

  it('automatically selects scaleDenom based on targetDpi', () => {
    const origW = 64;
    const origH = 64;
    const jpegBytes = makeTestJpeg(origW, origH, false);

    // 72 DPI on a 300 DPI image: ratio = 72/300 = 0.24 <= 0.35 -> scaleDenom = 4
    const imgAuto = JpegDecoder.decode(jpegBytes, { targetDpi: 72 });
    assert.strictEqual(imgAuto.width, 16);
    assert.strictEqual(imgAuto.height, 16);

    // 150 DPI on a 300 DPI image: ratio = 150/300 = 0.50 <= 0.70 -> scaleDenom = 2
    const imgAuto2 = JpegDecoder.decode(jpegBytes, { targetDpi: 150 });
    assert.strictEqual(imgAuto2.width, 32);
    assert.strictEqual(imgAuto2.height, 32);
  });

  it('handles non-multiple dimensions correctly with ceil', () => {
    const origW = 25; // Not multiple of 8
    const origH = 19;
    const jpegBytes = makeTestJpeg(origW, origH, false);

    const img4 = JpegDecoder.decode(jpegBytes, { scaleDenom: 4 });
    assert.strictEqual(img4.width, Math.ceil(25 / 4)); // 7
    assert.strictEqual(img4.height, Math.ceil(19 / 4)); // 5
    assert.strictEqual(img4.data.length, 7 * 5 * 3);
  });
});
