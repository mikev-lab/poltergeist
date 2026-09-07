/**
 * @file index.js
 * @description Unified raster format sniffer and router for Poltergeist.
 * Zero-dependency, memory-safe.
 */

import { PngDecoder } from './png/png_decoder.js';
import { TiffDecoder } from './tiff/tiff_decoder.js';
import { JpegDecoder } from './jpeg/jpeg_decoder.js';
import { BmpDecoder } from './bmp/bmp_decoder.js';
import { TgaDecoder } from './tga/tga_decoder.js';
import { WebpDecoder } from './webp/webp_decoder.js';

export { PngDecoder, TiffDecoder, JpegDecoder, BmpDecoder, TgaDecoder, WebpDecoder };

/**
 * Sniffs binary magic bytes and decodes any supported raster format.
 * @param {Uint8Array|Buffer} buffer 
 * @param {object} [options]
 * @returns {import('../../types/image.js').RasterImage}
 */
export function decodeRaster(buffer, options = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 4) {
    throw new Error('Buffer too small to determine image format.');
  }

  // PNG: \x89PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return PngDecoder.decode(bytes, options);
  }

  // JPEG: \xFF\xD8
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return JpegDecoder.decode(bytes);
  }

  // TIFF: 'II' or 'MM' with magic 42
  if ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d)) {
    return TiffDecoder.decode(bytes);
  }

  // WebP: RIFF....WEBP
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return WebpDecoder.decode(bytes);
  }

  // BMP: 'BM'
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return BmpDecoder.decode(bytes);
  }

  // TGA heuristic
  try {
    return TgaDecoder.decode(bytes);
  } catch {
    throw new Error('Unsupported or unrecognized raster image format.');
  }
}
