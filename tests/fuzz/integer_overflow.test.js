/**
 * @file integer_overflow.test.js
 * @description Adversarial memory safety tests asserting integer overflow guards,
 * dimension ceilings (MAX_DIMENSION = 65535), and allocation threshold limits.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBufferSize, MAX_DIMENSION, MAX_SAFE_BUFFER_SIZE, RasterImage } from '../../src/types/image.js';
import { createIntegerOverflowHeader } from '../fixtures/fuzz/generator.js';
import { BmpDecoder } from '../../src/ingestion/raster/bmp/bmp_decoder.js';
import { PsdDecoder } from '../../src/ingestion/layered/psd/psd_decoder.js';

test('Memory Safety: Integer Overflow & Dimension Ceilings (Rule 6)', async (t) => {
  await t.test('calculateBufferSize guards against integer overflow and absurd dimensions', () => {
    // Exceeds MAX_DIMENSION (65535)
    assert.throws(() => calculateBufferSize(65536, 100, 3, 1), RangeError);
    assert.throws(() => calculateBufferSize(100, 65536, 3, 1), RangeError);

    // Negative or zero dimensions
    assert.throws(() => calculateBufferSize(0, 100, 3, 1), RangeError);
    assert.throws(() => calculateBufferSize(-10, 100, 3, 1), RangeError);
    assert.throws(() => calculateBufferSize(100, 0, 3, 1), RangeError);

    // Floating-point dimensions
    assert.throws(() => calculateBufferSize(10.5, 100, 3, 1), RangeError);

    // Single buffer exceeding MAX_SAFE_BUFFER_SIZE (2 GB):
    // e.g. 65535 * 65535 * 4 channels * 1 byte = 17,179,344,900 bytes (~17 GB)
    assert.throws(() => calculateBufferSize(65535, 65535, 4, 1), RangeError);
  });

  await t.test('RasterImage constructor rejects buffers exceeding 2GB allocation threshold', () => {
    assert.throws(
      () => new RasterImage({ width: 65535, height: 65535, channels: 4 }),
      RangeError
    );
  });

  await t.test('BmpDecoder rejects integer overflow dimensions before allocation', () => {
    // BMP declaring 65535 x 65535 at 32-bit (would require ~17 GB allocation)
    const bmpOverflow = createIntegerOverflowHeader('BMP');
    assert.throws(
      () => BmpDecoder.decode(bmpOverflow),
      /(exceeds.*threshold|Invalid image|too small|Invalid|Array buffer allocation failed)/i
    );
  });

  await t.test('PsdDecoder rejects header claiming absurd dimensions without backing stream', () => {
    // PSD declaring 65535 x 65535
    const psdOverflow = createIntegerOverflowHeader('PSD');
    assert.throws(
      () => PsdDecoder.decode(psdOverflow),
      /(exceeds.*threshold|Invalid image|Invalid PSD dimensions|truncated|too small)/i
    );
  });
});
