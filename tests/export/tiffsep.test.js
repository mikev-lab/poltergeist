/**
 * @file tiffsep.test.js
 * @description Unit tests for SeparationPlateGenerator (Ghostscript tiffsep parity).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SeparationPlateGenerator } from '../../src/export/tiffsep/plate_generator.js';
import { TiffDecoder } from '../../src/ingestion/raster/tiff/tiff_decoder.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../src/types/image.js';

describe('SeparationPlateGenerator: Ghostscript tiffsep Parity', () => {
  it('Golden Path: Generates discrete C, M, Y, K plates and composite proof', () => {
    // 4x4 CMYK image
    const data = new Uint8Array(4 * 4 * 4);
    // Fill distinct channel gradients
    for (let p = 0; p < 16; p++) {
      data[p * 4] = p * 16;     // Cyan gradient
      data[p * 4 + 1] = 255 - p * 16; // Magenta gradient
      data[p * 4 + 2] = 128;    // Yellow flat
      data[p * 4 + 3] = 64;     // Black flat
    }

    const cmykImage = new RasterImage({
      width: 4,
      height: 4,
      channels: 4,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.CMYK,
      pixelFormat: PixelFormat.CMYK32,
      dpiX: 300,
      dpiY: 300,
      data
    });

    const plates = SeparationPlateGenerator.generatePlates(cmykImage, { jobName: 'catalog' });

    assert.ok(plates.has('catalog_Cyan.tif'));
    assert.ok(plates.has('catalog_Magenta.tif'));
    assert.ok(plates.has('catalog_Yellow.tif'));
    assert.ok(plates.has('catalog_Black.tif'));
    assert.ok(plates.has('catalog_composite.tif'));

    // Decode Cyan plate and verify channel extraction
    const cyanTiff = plates.get('catalog_Cyan.tif');
    const cyanImg = TiffDecoder.decode(cyanTiff);

    assert.equal(cyanImg.width, 4);
    assert.equal(cyanImg.height, 4);
    assert.equal(cyanImg.channels, 1);
    assert.equal(cyanImg.colorSpace, ColorSpaceType.GRAY);
    assert.equal(cyanImg.data[0], 0);
    assert.equal(cyanImg.data[15], 15 * 16);

    // Decode Composite proof and verify 4-channel CMYK
    const compTiff = plates.get('catalog_composite.tif');
    const compImg = TiffDecoder.decode(compTiff);

    assert.equal(compImg.width, 4);
    assert.equal(compImg.height, 4);
    assert.equal(compImg.channels, 4);
    assert.equal(compImg.colorSpace, ColorSpaceType.CMYK);
  });

  it('Spot Colors: Extracts discrete plate for DeviceN spot color', () => {
    // 2x2 image with 5 channels: C, M, Y, K, PANTONE 185 C
    const data = new Uint8Array(2 * 2 * 5);
    data[4] = 200; // Spot ink on pixel 0

    const deviceNImage = new RasterImage({
      width: 2,
      height: 2,
      channels: 5,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.DEVICE_N,
      pixelFormat: PixelFormat.DEVICE_N,
      spotNames: ['PANTONE 185 C'],
      data
    });

    const plates = SeparationPlateGenerator.generatePlates(deviceNImage, { jobName: 'packaging' });

    assert.ok(plates.has('packaging_PANTONE_185_C.tif'));
    const spotTiff = plates.get('packaging_PANTONE_185_C.tif');
    const spotImg = TiffDecoder.decode(spotTiff);

    assert.equal(spotImg.width, 2);
    assert.equal(spotImg.height, 2);
    assert.equal(spotImg.channels, 1);
    assert.equal(spotImg.data[0], 200);
  });

  it('Edge Case: Rejects RGB image for separation plates', () => {
    const rgbImage = new RasterImage({ width: 2, height: 2, channels: 3, colorSpace: ColorSpaceType.RGB });
    assert.throws(() => {
      SeparationPlateGenerator.generatePlates(rgbImage);
    }, /requires CMYK or DeviceN/i);
  });
});
