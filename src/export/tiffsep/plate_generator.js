/**
 * @file plate_generator.js
 * @description Discrete separation plates generator for Poltergeist (Ghostscript tiffsep equivalent).
 * Generates continuous-tone (8-bit) and screened plates for C, M, Y, K, and individual DeviceN spot colors.
 */

import { RasterImage, PixelFormat, ColorSpaceType } from '../../types/image.js';
import { TiffWriter } from '../tiff/tiff_writer.js';

export class SeparationPlateGenerator {
  /**
   * Generates discrete plate TIFFs from a CMYK (or DeviceN) RasterImage.
   * @param {RasterImage} image 
   * @param {object} [options]
   * @param {string} [options.jobName='job']
   * @param {boolean} [options.includeComposite=true]
   * @returns {Map<string, Uint8Array>} Map of plate filenames to binary TIFF buffers
   */
  static generatePlates(image, options = {}) {
    if (image.colorSpace !== ColorSpaceType.CMYK && image.colorSpace !== ColorSpaceType.DEVICE_N) {
      throw new TypeError(`Separation plate generation requires CMYK or DeviceN image. Got: ${image.colorSpace}`);
    }

    const jobName = options.jobName || 'job';
    const includeComposite = options.includeComposite !== false;
    const { width, height, channels, data, dpiX, dpiY } = image;
    const numPixels = width * height;

    const plates = new Map();

    const channelNames = ['Cyan', 'Magenta', 'Yellow', 'Black'];
    if (image.spotNames && image.spotNames.length > 0) {
      for (let i = 0; i < image.spotNames.length; i++) {
        channelNames.push(image.spotNames[i].replace(/[^a-zA-Z0-9_-]/g, '_'));
      }
    }

    // Extract each channel into a 1-channel grayscale RasterImage and serialize as TIFF
    for (let c = 0; c < channels; c++) {
      const plateData = new Uint8Array(numPixels);
      for (let p = 0; p < numPixels; p++) {
        plateData[p] = data[p * channels + c];
      }

      const plateImage = new RasterImage({
        width,
        height,
        channels: 1,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.GRAY,
        pixelFormat: PixelFormat.GRAY8,
        dpiX,
        dpiY,
        data: plateData
      });

      const plateTiff = TiffWriter.write(plateImage, { compress: true });
      const name = channelNames[c] || `Channel_${c}`;
      plates.set(`${jobName}_${name}.tif`, plateTiff);
    }

    // Composite proof TIFF (4-channel CMYK)
    if (includeComposite && channels >= 4) {
      let compositeData;
      if (channels === 4) {
        compositeData = data;
      } else {
        // Strip spot channels for standard 4-channel CMYK proof
        compositeData = new Uint8Array(numPixels * 4);
        for (let p = 0; p < numPixels; p++) {
          compositeData[p * 4] = data[p * channels];
          compositeData[p * 4 + 1] = data[p * channels + 1];
          compositeData[p * 4 + 2] = data[p * channels + 2];
          compositeData[p * 4 + 3] = data[p * channels + 3];
        }
      }

      const compositeImage = new RasterImage({
        width,
        height,
        channels: 4,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.CMYK,
        pixelFormat: PixelFormat.CMYK32,
        dpiX,
        dpiY,
        data: compositeData,
        iccProfile: image.iccProfile
      });

      const compositeTiff = TiffWriter.write(compositeImage, { compress: true });
      plates.set(`${jobName}_composite.tif`, compositeTiff);
    }

    return plates;
  }
}
