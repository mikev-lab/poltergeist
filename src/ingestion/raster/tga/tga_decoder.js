/**
 * @file tga_decoder.js
 * @description Pure native Truevision TGA decoder for Poltergeist.
 * Supports uncompressed and RLE compressed truecolor and grayscale.
 */

import { RasterImage, PixelFormat, ColorSpaceType } from '../../../types/image.js';

export class TgaDecoder {
  /**
   * Decodes a TGA binary buffer into a RasterImage.
   * @param {Uint8Array|Buffer} buffer 
   * @returns {RasterImage}
   */
  static decode(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 18) {
      throw new Error('Invalid TGA stream: header is less than 18 bytes.');
    }

    const idLength = bytes[0];
    const imageType = bytes[2];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const width = view.getUint16(12, true);
    const height = view.getUint16(14, true);
    const pixelDepth = bytes[16];
    const descriptor = bytes[17];
    const isTopDown = (descriptor & 0x20) !== 0;

    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid TGA dimensions: ${width}x${height}`);
    }

    const isRle = imageType === 10 || imageType === 11;
    const isGray = imageType === 3 || imageType === 11;

    let channels = 3;
    let colorSpace = ColorSpaceType.RGB;
    let pixelFormat = PixelFormat.RGB24;
    let hasAlpha = false;

    if (isGray) {
      channels = 1;
      colorSpace = ColorSpaceType.GRAY;
      pixelFormat = PixelFormat.GRAY8;
    } else if (pixelDepth === 32) {
      channels = 4;
      pixelFormat = PixelFormat.RGBA32;
      hasAlpha = true;
    }

    const bytesPerPixel = Math.floor(pixelDepth / 8);
    const outData = new Uint8Array(width * height * channels);
    let inPos = 18 + idLength;

    const totalPixels = width * height;
    const rawPixels = new Uint8Array(totalPixels * bytesPerPixel);

    if (!isRle) {
      const copyLen = Math.min(bytes.length - inPos, rawPixels.length);
      rawPixels.set(bytes.subarray(inPos, inPos + copyLen));
    } else {
      let pixelCount = 0;
      while (pixelCount < totalPixels && inPos < bytes.length) {
        const packetHeader = bytes[inPos++];
        const count = (packetHeader & 0x7f) + 1;
        const isRun = (packetHeader & 0x80) !== 0;

        if (isRun) {
          const pixel = bytes.subarray(inPos, inPos + bytesPerPixel);
          inPos += bytesPerPixel;
          for (let i = 0; i < count && pixelCount < totalPixels; i++) {
            rawPixels.set(pixel, pixelCount * bytesPerPixel);
            pixelCount++;
          }
        } else {
          for (let i = 0; i < count && pixelCount < totalPixels && inPos + bytesPerPixel <= bytes.length; i++) {
            rawPixels.set(bytes.subarray(inPos, inPos + bytesPerPixel), pixelCount * bytesPerPixel);
            inPos += bytesPerPixel;
            pixelCount++;
          }
        }
      }
    }

    // Rearrange scanlines according to orientation and convert BGR -> RGB
    for (let y = 0; y < height; y++) {
      const srcY = isTopDown ? y : (height - 1 - y);
      const srcRowStart = srcY * width * bytesPerPixel;
      const destRowStart = y * width * channels;

      if (isGray) {
        outData.set(rawPixels.subarray(srcRowStart, srcRowStart + width), destRowStart);
      } else if (bytesPerPixel === 3) {
        for (let x = 0; x < width; x++) {
          const b = rawPixels[srcRowStart + x * 3];
          const g = rawPixels[srcRowStart + x * 3 + 1];
          const r = rawPixels[srcRowStart + x * 3 + 2];
          outData[destRowStart + x * 3] = r;
          outData[destRowStart + x * 3 + 1] = g;
          outData[destRowStart + x * 3 + 2] = b;
        }
      } else if (bytesPerPixel === 4) {
        for (let x = 0; x < width; x++) {
          const b = rawPixels[srcRowStart + x * 4];
          const g = rawPixels[srcRowStart + x * 4 + 1];
          const r = rawPixels[srcRowStart + x * 4 + 2];
          const a = rawPixels[srcRowStart + x * 4 + 3];
          outData[destRowStart + x * 4] = r;
          outData[destRowStart + x * 4 + 1] = g;
          outData[destRowStart + x * 4 + 2] = b;
          outData[destRowStart + x * 4 + 3] = a;
        }
      }
    }

    return new RasterImage({
      width,
      height,
      channels,
      bitsPerSample: 8,
      colorSpace,
      pixelFormat,
      dpiX: 300,
      dpiY: 300,
      data: outData,
      hasAlpha
    });
  }
}
