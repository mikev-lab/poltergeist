/**
 * @file resample.test.js
 * @description Unit tests for 1D convolution kernels, 2D separable resampling, and prepress downsampler.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BoxFilter,
  BilinearFilter,
  BicubicCatmullRomFilter,
  Lanczos3Filter
} from '../../src/compositor/resample/filters.js';
import { resample, downsampleForPrepress } from '../../src/compositor/resample/resample.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../src/types/image.js';

describe('FilterKernel: Mathematical Accuracy & Symmetry', () => {
  it('Math: Lanczos-3 evaluates to 1 at 0 and 0 at integer nodes 1, 2, 3', () => {
    assert.equal(Lanczos3Filter.fn(0), 1.0);
    assert.ok(Math.abs(Lanczos3Filter.fn(1)) < 1e-6);
    assert.ok(Math.abs(Lanczos3Filter.fn(2)) < 1e-6);
    assert.equal(Lanczos3Filter.fn(3), 0.0);
    assert.equal(Lanczos3Filter.fn(4), 0.0); // Outside radius
  });

  it('Math: Catmull-Rom Bicubic is symmetric and evaluates properly', () => {
    assert.equal(BicubicCatmullRomFilter.fn(0), 1.0);
    assert.equal(BicubicCatmullRomFilter.fn(0.5), BicubicCatmullRomFilter.fn(-0.5));
    assert.equal(BicubicCatmullRomFilter.fn(2.0), 0.0);
  });
});

describe('Resampling Engine: 2D Separable Convolution', () => {
  it('Identity: Same dimension resampling returns identical image', () => {
    const data = new Uint8Array([10, 20, 30, 40]);
    const image = new RasterImage({ width: 2, height: 2, channels: 1, data });
    const result = resample(image, 2, 2);
    assert.equal(result, image);
  });

  it('Golden Path: Upsamples 2x2 image to 4x4 smoothly with Lanczos-3', () => {
    // 2x2 grayscale: top row 0, bottom row 255
    const data = new Uint8Array([
      0,   0,
      255, 255
    ]);
    const image = new RasterImage({ width: 2, height: 2, channels: 1, data });
    const upsampled = resample(image, 4, 4, { filter: Lanczos3Filter });

    assert.equal(upsampled.width, 4);
    assert.equal(upsampled.height, 4);

    // Top row should be close to 0, bottom row close to 255, middle rows interpolated
    assert.ok(upsampled.data[0] < 50);
    assert.ok(upsampled.data[12] > 200);
    assert.ok(upsampled.data[4] > upsampled.data[0]); // Monotonic transition
  });

  it('Golden Path: Downsamples 4x4 image to 2x2 with anti-aliasing', () => {
    const data = new Uint8Array(16);
    data.fill(100);
    const image = new RasterImage({ width: 4, height: 4, channels: 1, data });
    const downsampled = resample(image, 2, 2);

    assert.equal(downsampled.width, 2);
    assert.equal(downsampled.height, 2);
    // Flat image preserves constant average value
    for (let i = 0; i < 4; i++) {
      assert.ok(Math.abs(downsampled.data[i] - 100) <= 2);
    }
  });

  it('Edge Case: Rejects invalid target dimensions', () => {
    const image = new RasterImage({ width: 2, height: 2, channels: 1 });
    assert.throws(() => resample(image, 0, 2), /target width/i);
    assert.throws(() => resample(image, 2, -1), /target height/i);
  });
});

describe('Prepress Threshold Downsampler', () => {
  it('Prepress: Downsamples image at 600 DPI to 300 DPI target', () => {
    // 400x400 at 600 DPI -> should scale to 200x200 at 300 DPI
    const data = new Uint8Array(400 * 400);
    const image = new RasterImage({
      width: 400,
      height: 400,
      channels: 1,
      dpiX: 600,
      dpiY: 600,
      data
    });

    const result = downsampleForPrepress(image, { thresholdDpi: 450, targetDpi: 300 });

    assert.equal(result.width, 200);
    assert.equal(result.height, 200);
    assert.equal(result.dpiX, 300);
    assert.equal(result.dpiY, 300);
  });

  it('Prepress: Preserves image at 300 DPI (below 450 DPI threshold)', () => {
    const data = new Uint8Array(100 * 100);
    const image = new RasterImage({
      width: 100,
      height: 100,
      channels: 1,
      dpiX: 300,
      dpiY: 300,
      data
    });

    const result = downsampleForPrepress(image, { thresholdDpi: 450, targetDpi: 300 });
    assert.equal(result, image); // Unchanged instance
  });
});
