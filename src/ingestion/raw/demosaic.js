/**
 * @file demosaic.js
 * @description High-speed Bayer CFA demosaicing and sensor color calibration for Camera RAW.
 * Strictly zero-dependency and memory-safe.
 */

import { ColorChannel, CfaPattern } from './cfa.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../types/image.js';

export class RawDemosaicer {
  /**
   * Demosaics a raw CFA mosaic buffer into a calibrated 8-bit RGB RasterImage.
   * 
   * @param {Uint16Array|Uint8Array} cfaData Single channel sensor data of length width * height
   * @param {import('./cfa.js').RawMetadata} metadata
   * @returns {RasterImage}
   */
  static demosaic(cfaData, metadata) {
    const { width, height } = metadata;
    if (width <= 0 || height <= 0) {
      throw new RangeError(`Invalid RAW dimensions: ${width}x${height}`);
    }

    const numPixels = width * height;
    if (cfaData.length < numPixels) {
      throw new RangeError(`CFA buffer length (${cfaData.length}) smaller than width * height (${numPixels})`);
    }

    const black = metadata.blackLevel;
    const white = metadata.whiteLevel;
    const wb = metadata.whiteBalance || [1.0, 1.0, 1.0];

    // Normalized floating point buffer for linear RGB [0..1]
    // 3 channels: R=0, G=1, B=2
    const rgbData = new Uint8Array(numPixels * 3);

    // Helper to get normalized sensel value
    function getSensel(r, c) {
      const idx = r * width + c;
      const rawVal = cfaData[idx];
      const ch = metadata.getChannelAt(r, c);
      const bLevel = black[ch] || black[0] || 0;
      const range = Math.max(1, white - bLevel);
      const val = Math.max(0, rawVal - bLevel) / range;
      const gain = wb[ch] || 1.0;
      return Math.min(1.0, val * gain);
    }

    // Bilinear demosaicing with boundary clamping
    for (let r = 0; r < height; r++) {
      const rMin = Math.max(0, r - 1);
      const rMax = Math.min(height - 1, r + 1);

      for (let c = 0; c < width; c++) {
        const cMin = Math.max(0, c - 1);
        const cMax = Math.min(width - 1, c + 1);

        const ch = metadata.getChannelAt(r, c);
        let red = 0;
        let green = 0;
        let blue = 0;

        if (ch === ColorChannel.RED) {
          red = getSensel(r, c);
          // Green from 4-neighbors (cross)
          green = (getSensel(rMin, c) + getSensel(rMax, c) + getSensel(r, cMin) + getSensel(r, cMax)) / 4.0;
          // Blue from 4-diagonal neighbors
          blue = (getSensel(rMin, cMin) + getSensel(rMin, cMax) + getSensel(rMax, cMin) + getSensel(rMax, cMax)) / 4.0;
        } else if (ch === ColorChannel.BLUE) {
          blue = getSensel(r, c);
          // Green from 4-neighbors (cross)
          green = (getSensel(rMin, c) + getSensel(rMax, c) + getSensel(r, cMin) + getSensel(r, cMax)) / 4.0;
          // Red from 4-diagonal neighbors
          red = (getSensel(rMin, cMin) + getSensel(rMin, cMax) + getSensel(rMax, cMin) + getSensel(rMax, cMax)) / 4.0;
        } else {
          // Green sensel
          green = getSensel(r, c);
          // Determine whether horizontal neighbors are Red or Blue
          const isRowRed = metadata.getChannelAt(r, cMin) === ColorChannel.RED || metadata.getChannelAt(r, cMax) === ColorChannel.RED;
          if (isRowRed) {
            red = (getSensel(r, cMin) + getSensel(r, cMax)) / 2.0;
            blue = (getSensel(rMin, c) + getSensel(rMax, c)) / 2.0;
          } else {
            blue = (getSensel(r, cMin) + getSensel(r, cMax)) / 2.0;
            red = (getSensel(rMin, c) + getSensel(rMax, c)) / 2.0;
          }
        }

        // Apply sRGB tone curve: sRGB = 1.055 * V^(1/2.4) - 0.055
        const rByte = RawDemosaicer._linearToSrgbByte(red);
        const gByte = RawDemosaicer._linearToSrgbByte(green);
        const bByte = RawDemosaicer._linearToSrgbByte(blue);

        const outIdx = (r * width + c) * 3;
        rgbData[outIdx] = rByte;
        rgbData[outIdx + 1] = gByte;
        rgbData[outIdx + 2] = bByte;
      }
    }

    return new RasterImage({
      width,
      height,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      dpiX: 300,
      dpiY: 300,
      data: rgbData
    });
  }

  /**
   * Converts linear channel value [0..1] to sRGB 8-bit integer [0..255].
   * @private
   * @param {number} val
   * @returns {number}
   */
  static _linearToSrgbByte(val) {
    const clamped = Math.max(0.0, Math.min(1.0, val));
    let srgb;
    if (clamped <= 0.0031308) {
      srgb = 12.92 * clamped;
    } else {
      srgb = 1.055 * Math.pow(clamped, 1.0 / 2.4) - 0.055;
    }
    return Math.round(Math.max(0.0, Math.min(1.0, srgb)) * 255.0);
  }
}
