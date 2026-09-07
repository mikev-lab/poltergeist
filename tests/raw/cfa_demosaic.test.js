/**
 * @file cfa_demosaic.test.js
 * @description Comprehensive unit tests for Bayer CFA sensel mapping and demosaicing algorithms.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CfaPattern, ColorChannel, RawMetadata } from '../../src/ingestion/raw/cfa.js';
import { RawDemosaicer } from '../../src/ingestion/raw/demosaic.js';
import { ColorSpaceType, PixelFormat } from '../../src/types/image.js';

test('Bayer CFA Pattern Geometry & Channel Mapping', async (t) => {
  await t.test('RGGB sensel channel assignments', () => {
    const meta = new RawMetadata({ width: 4, height: 4, cfaPattern: CfaPattern.RGGB });
    assert.equal(meta.getChannelAt(0, 0), ColorChannel.RED);
    assert.equal(meta.getChannelAt(0, 1), ColorChannel.GREEN);
    assert.equal(meta.getChannelAt(1, 0), ColorChannel.GREEN);
    assert.equal(meta.getChannelAt(1, 1), ColorChannel.BLUE);

    assert.equal(meta.getChannelAt(2, 2), ColorChannel.RED);
    assert.equal(meta.getChannelAt(2, 3), ColorChannel.GREEN);
    assert.equal(meta.getChannelAt(3, 2), ColorChannel.GREEN);
    assert.equal(meta.getChannelAt(3, 3), ColorChannel.BLUE);
  });

  await t.test('BGGR sensel channel assignments', () => {
    const meta = new RawMetadata({ width: 2, height: 2, cfaPattern: CfaPattern.BGGR });
    assert.equal(meta.getChannelAt(0, 0), ColorChannel.BLUE);
    assert.equal(meta.getChannelAt(0, 1), ColorChannel.GREEN);
    assert.equal(meta.getChannelAt(1, 0), ColorChannel.GREEN);
    assert.equal(meta.getChannelAt(1, 1), ColorChannel.RED);
  });

  await t.test('GRBG sensel channel assignments', () => {
    const meta = new RawMetadata({ width: 2, height: 2, cfaPattern: CfaPattern.GRBG });
    assert.equal(meta.getChannelAt(0, 0), ColorChannel.GREEN);
    assert.equal(meta.getChannelAt(0, 1), ColorChannel.RED);
    assert.equal(meta.getChannelAt(1, 0), ColorChannel.BLUE);
    assert.equal(meta.getChannelAt(1, 1), ColorChannel.GREEN);
  });

  await t.test('GBRG sensel channel assignments', () => {
    const meta = new RawMetadata({ width: 2, height: 2, cfaPattern: CfaPattern.GBRG });
    assert.equal(meta.getChannelAt(0, 0), ColorChannel.GREEN);
    assert.equal(meta.getChannelAt(0, 1), ColorChannel.BLUE);
    assert.equal(meta.getChannelAt(1, 0), ColorChannel.RED);
    assert.equal(meta.getChannelAt(1, 1), ColorChannel.GREEN);
  });
});

test('RawDemosaicer: Bilinear Interpolation & Color Calibration', async (t) => {
  await t.test('Golden Path: Demosaics 4x4 RGGB sensor mosaic into RGB24 RasterImage', () => {
    const width = 4;
    const height = 4;
    const cfaData = new Uint16Array(width * height);
    // Fill with simulated uniform gray (raw sensel = 32768, 50% saturation)
    cfaData.fill(32768);

    const meta = new RawMetadata({
      width,
      height,
      cfaPattern: CfaPattern.RGGB,
      blackLevel: 0,
      whiteLevel: 65535,
      whiteBalance: [1.0, 1.0, 1.0]
    });

    const raster = RawDemosaicer.demosaic(cfaData, meta);
    assert.equal(raster.width, 4);
    assert.equal(raster.height, 4);
    assert.equal(raster.channels, 3);
    assert.equal(raster.colorSpace, ColorSpaceType.RGB);
    assert.equal(raster.pixelFormat, PixelFormat.RGB24);
    assert.equal(raster.data.length, 4 * 4 * 3);

    // Demosaiced values should be close to mid-gray (~188 in sRGB with 0.5 linear)
    const midIdx = (2 * width + 2) * 3;
    const midR = raster.data[midIdx];
    const midG = raster.data[midIdx + 1];
    const midB = raster.data[midIdx + 2];
    assert.ok(midR > 180 && midR < 195, `Red channel expected ~188, got ${midR}`);
    assert.ok(midG > 180 && midG < 195, `Green channel expected ~188, got ${midG}`);
    assert.ok(midB > 180 && midB < 195, `Blue channel expected ~188, got ${midB}`);
  });

  await t.test('Black level subtraction and white level scaling', () => {
    const width = 2;
    const height = 2;
    const cfaData = new Uint16Array([512, 512, 512, 512]); // exactly at black level
    const meta = new RawMetadata({
      width,
      height,
      cfaPattern: CfaPattern.RGGB,
      blackLevel: 512,
      whiteLevel: 4096
    });

    const raster = RawDemosaicer.demosaic(cfaData, meta);
    // Sensel value 512 - 512 = 0 -> sRGB should be 0
    assert.equal(raster.data[0], 0);
    assert.equal(raster.data[1], 0);
    assert.equal(raster.data[2], 0);
  });

  await t.test('Deep Edge Case: Minimal 2x2 sensor cell', () => {
    const width = 2;
    const height = 2;
    // R: 65535, G1: 0, G2: 0, B: 0
    const cfaData = new Uint16Array([65535, 0, 0, 0]);
    const meta = new RawMetadata({ width, height, cfaPattern: CfaPattern.RGGB, whiteLevel: 65535 });
    const raster = RawDemosaicer.demosaic(cfaData, meta);
    assert.equal(raster.width, 2);
    assert.equal(raster.height, 2);
  });

  await t.test('Adversarial: Throws on invalid dimensions or truncated buffer', () => {
    const meta0 = new RawMetadata({ width: 0, height: 10 });
    assert.throws(() => RawDemosaicer.demosaic(new Uint16Array(10), meta0), RangeError);

    const metaSmall = new RawMetadata({ width: 10, height: 10 });
    assert.throws(() => RawDemosaicer.demosaic(new Uint16Array(50), metaSmall), RangeError);
  });
});
