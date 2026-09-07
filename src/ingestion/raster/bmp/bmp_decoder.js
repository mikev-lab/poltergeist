/**
 * @file bmp_decoder.js
 * @description Pure native Windows BMP decoder for Poltergeist.
 * Supports 24-bit RGB, 32-bit RGBA, 8-bit palette, bottom-up and top-down orientation.
 */

import { RasterImage, PixelFormat, ColorSpaceType, calculateBufferSize } from '../../../types/image.js';

export class BmpDecoder {
  /**
   * Decodes a BMP binary buffer into a RasterImage.
   * @param {Uint8Array|Buffer} buffer 
   * @returns {RasterImage}
   */
  static decode(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 14 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
      throw new Error('Invalid BMP stream: "BM" signature missing.');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dataOffset = view.getUint32(10, true);
    const dibHeaderSize = view.getUint32(14, true);

    if (dibHeaderSize < 40) {
      throw new Error(`Unsupported legacy BMP header size: ${dibHeaderSize}`);
    }

    const width = view.getInt32(18, true);
    const rawHeight = view.getInt32(22, true);
    const isTopDown = rawHeight < 0;
    const height = Math.abs(rawHeight);

    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid BMP dimensions: ${width}x${height}`);
    }

    const planes = view.getUint16(26, true);
    const bitsPerPixel = view.getUint16(28, true);
    const compression = view.getUint32(30, true); // 0=BI_RGB, 3=BI_BITFIELDS

    const ppmX = view.getInt32(38, true);
    const ppmY = view.getInt32(42, true);
    const dpiX = ppmX > 0 ? Math.round(ppmX * 0.0254) : 300;
    const dpiY = ppmY > 0 ? Math.round(ppmY * 0.0254) : 300;

    let palette = null;
    if (bitsPerPixel === 8) {
      const paletteOffset = 14 + dibHeaderSize;
      palette = new Uint8Array(256 * 3);
      for (let i = 0; i < 256; i++) {
        const palEntryOffset = paletteOffset + i * 4;
        if (palEntryOffset + 3 <= bytes.length) {
          palette[i * 3] = bytes[palEntryOffset + 2];     // R
          palette[i * 3 + 1] = bytes[palEntryOffset + 1]; // G
          palette[i * 3 + 2] = bytes[palEntryOffset];     // B
        }
      }
    }

    let channels = 3;
    let pixelFormat = PixelFormat.RGB24;
    let hasAlpha = false;

    if (bitsPerPixel === 32) {
      channels = 4;
      pixelFormat = PixelFormat.RGBA32;
      hasAlpha = true;
    }

    calculateBufferSize(width, height, channels, 1);

    const outData = new Uint8Array(width * height * channels);
    const rowByteLength = Math.floor((width * bitsPerPixel + 31) / 32) * 4;

    for (let y = 0; y < height; y++) {
      const srcY = isTopDown ? y : (height - 1 - y);
      const srcOffset = dataOffset + srcY * rowByteLength;
      const destOffset = y * width * channels;

      if (srcOffset + rowByteLength > bytes.length) {
        break; // Guard truncated buffers
      }

      if (bitsPerPixel === 24) {
        let srcPos = srcOffset;
        let destPos = destOffset;
        for (let x = 0; x < width; x++) {
          const b = bytes[srcPos++];
          const g = bytes[srcPos++];
          const r = bytes[srcPos++];
          outData[destPos++] = r;
          outData[destPos++] = g;
          outData[destPos++] = b;
        }
      } else if (bitsPerPixel === 32) {
        let srcPos = srcOffset;
        let destPos = destOffset;
        for (let x = 0; x < width; x++) {
          const b = bytes[srcPos++];
          const g = bytes[srcPos++];
          const r = bytes[srcPos++];
          const a = bytes[srcPos++];
          outData[destPos++] = r;
          outData[destPos++] = g;
          outData[destPos++] = b;
          outData[destPos++] = a;
        }
      } else if (bitsPerPixel === 8 && palette) {
        let destPos = destOffset;
        for (let x = 0; x < width; x++) {
          const palIdx = bytes[srcOffset + x] * 3;
          outData[destPos++] = palette[palIdx];
          outData[destPos++] = palette[palIdx + 1];
          outData[destPos++] = palette[palIdx + 2];
        }
      }
    }

    return new RasterImage({
      width,
      height,
      channels,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat,
      dpiX,
      dpiY,
      data: outData,
      palette,
      hasAlpha
    });
  }
}
