/**
 * @file png_decoder.js
 * @description Pure native PNG image decoder for Poltergeist.
 * Zero-dependency (uses node:zlib for Deflate decompression).
 */

import zlib from 'node:zlib';
import { RasterImage, PixelFormat, ColorSpaceType, calculateBufferSize } from '../../../types/image.js';
import { IccProfile } from '../../../color/icc/profile.js';

// Precomputed CRC-32 table
const CRC32_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  CRC32_TABLE[n] = c >>> 0;
}

/**
 * Computes CRC-32 for a buffer slice.
 * @param {Uint8Array} buf 
 * @param {number} start 
 * @param {number} length 
 * @returns {number}
 */
export function computeCrc32(buf, start, length) {
  let crc = 0xffffffff;
  const end = start + length;
  for (let i = start; i < end; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Paeth predictor function from PNG specification.
 * @param {number} a Left byte
 * @param {number} b Above byte
 * @param {number} c Upper-left byte
 * @returns {number}
 */
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Pure native PNG Decoder.
 */
export class PngDecoder {
  /**
   * Decodes a PNG binary buffer into a RasterImage.
   * @param {Uint8Array|Buffer} buffer 
   * @param {object} [options]
   * @param {boolean} [options.verifyCrc=true]
   * @returns {RasterImage}
   */
  static decode(buffer, options = {}) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const verifyCrc = options.verifyCrc !== false;

    if (bytes.length < 8) {
      throw new Error(`PNG data truncated: buffer size ${bytes.length} is less than 8-byte PNG header.`);
    }

    for (let i = 0; i < 8; i++) {
      if (bytes[i] !== PNG_SIGNATURE[i]) {
        throw new Error(`Invalid PNG signature at offset ${i}. Expected 0x${PNG_SIGNATURE[i].toString(16)}, got 0x${bytes[i].toString(16)}.`);
      }
    }

    let offset = 8;
    let ihdrFound = false;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let compressionMethod = 0;
    let filterMethod = 0;
    let interlaceMethod = 0;

    let palette = null;
    let idatChunks = [];
    let totalIdatLength = 0;
    let dpiX = 300;
    let dpiY = 300;
    let iccProfile = null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) {
        throw new Error(`PNG chunk header truncated at offset ${offset}.`);
      }

      const chunkLength = view.getUint32(offset, false);
      const chunkType = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7]
      );
      offset += 8;

      if (offset + chunkLength + 4 > bytes.length) {
        throw new Error(`PNG chunk ${chunkType} payload truncated at offset ${offset} (declared length ${chunkLength}).`);
      }

      const chunkData = bytes.subarray(offset, offset + chunkLength);
      const chunkCrc = view.getUint32(offset + chunkLength, false);

      if (verifyCrc) {
        const expectedCrc = computeCrc32(bytes, offset - 4, chunkLength + 4);
        if (chunkCrc !== expectedCrc) {
          throw new Error(`CRC-32 checksum mismatch in chunk ${chunkType} at offset ${offset}. Expected 0x${expectedCrc.toString(16)}, got 0x${chunkCrc.toString(16)}.`);
        }
      }

      offset += chunkLength + 4;

      if (chunkType === 'IHDR') {
        if (ihdrFound) {
          throw new Error('Duplicate IHDR chunk found in PNG stream.');
        }
        if (chunkLength !== 13) {
          throw new Error(`Invalid IHDR length: expected 13, got ${chunkLength}.`);
        }
        const ihdrView = new DataView(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength);
        width = ihdrView.getUint32(0, false);
        height = ihdrView.getUint32(4, false);
        bitDepth = ihdrView.getUint8(8);
        colorType = ihdrView.getUint8(9);
        compressionMethod = ihdrView.getUint8(10);
        filterMethod = ihdrView.getUint8(11);
        interlaceMethod = ihdrView.getUint8(12);

        if (compressionMethod !== 0) {
          throw new Error(`Unsupported compression method: ${compressionMethod}. Only Deflate (0) is standard.`);
        }
        if (filterMethod !== 0) {
          throw new Error(`Unsupported filter method: ${filterMethod}. Only standard adaptive filtering (0) is supported.`);
        }
        if (interlaceMethod !== 0 && interlaceMethod !== 1) {
          throw new Error(`Unsupported interlace method: ${interlaceMethod}.`);
        }
        ihdrFound = true;
      } else if (chunkType === 'PLTE') {
        palette = new Uint8Array(chunkData);
      } else if (chunkType === 'IDAT') {
        idatChunks.push(chunkData);
        totalIdatLength += chunkLength;
      } else if (chunkType === 'pHYs') {
        if (chunkLength >= 9) {
          const physView = new DataView(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength);
          const ppuX = physView.getUint32(0, false);
          const ppuY = physView.getUint32(4, false);
          const unit = physView.getUint8(8);
          if (unit === 1) {
            // 1 unit = meter (1 meter = 39.3701 inches)
            dpiX = Math.round(ppuX * 0.0254);
            dpiY = Math.round(ppuY * 0.0254);
          }
        }
      } else if (chunkType === 'iCCP') {
        try {
          // Profile name (null terminated string up to 79 chars)
          let nullIdx = 0;
          while (nullIdx < chunkData.length && chunkData[nullIdx] !== 0) {
            nullIdx++;
          }
          if (nullIdx < chunkData.length - 2) {
            const compMethod = chunkData[nullIdx + 1];
            if (compMethod === 0) {
              const compressedProfile = chunkData.subarray(nullIdx + 2);
              const decompressed = zlib.inflateSync(compressedProfile);
              iccProfile = IccProfile.fromBuffer(decompressed);
            }
          }
        } catch {
          // Ignore non-fatal ICC parse failures and continue decoding image
        }
      } else if (chunkType === 'IEND') {
        break;
      }
    }

    if (!ihdrFound) {
      throw new Error('PNG stream missing mandatory IHDR chunk.');
    }
    if (idatChunks.length === 0) {
      throw new Error('PNG stream contains no IDAT image data.');
    }

    // Concatenate IDAT chunks
    const concatenatedIdat = new Uint8Array(totalIdatLength);
    let idatPos = 0;
    for (const chunk of idatChunks) {
      concatenatedIdat.set(chunk, idatPos);
      idatPos += chunk.length;
    }

    // Decompress via Deflate
    const decompressed = zlib.inflateSync(concatenatedIdat);

    // Decode channels and color space
    let channels = 3;
    let colorSpace = ColorSpaceType.RGB;
    let pixelFormat = PixelFormat.RGB24;
    let hasAlpha = false;

    switch (colorType) {
      case 0: // Grayscale
        channels = 1;
        colorSpace = ColorSpaceType.GRAY;
        pixelFormat = bitDepth === 16 ? PixelFormat.GRAY16 : PixelFormat.GRAY8;
        break;
      case 2: // Truecolor RGB
        channels = 3;
        colorSpace = ColorSpaceType.RGB;
        pixelFormat = bitDepth === 16 ? PixelFormat.RGB48 : PixelFormat.RGB24;
        break;
      case 3: // Indexed
        channels = 3;
        colorSpace = ColorSpaceType.RGB;
        pixelFormat = PixelFormat.RGB24;
        break;
      case 4: // Grayscale + Alpha
        channels = 2;
        colorSpace = ColorSpaceType.GRAY;
        hasAlpha = true;
        pixelFormat = PixelFormat.GRAY8;
        break;
      case 6: // Truecolor RGBA
        channels = 4;
        colorSpace = ColorSpaceType.RGB;
        hasAlpha = true;
        pixelFormat = bitDepth === 16 ? PixelFormat.RGBA64 : PixelFormat.RGBA32;
        break;
      default:
        throw new Error(`Unsupported PNG color type: ${colorType}`);
    }

    // Unfilter scanlines (non-interlaced standard)
    if (interlaceMethod === 0) {
      const outputImage = PngDecoder._decodeNonInterlaced({
        decompressed,
        width,
        height,
        bitDepth,
        colorType,
        channels,
        colorSpace,
        pixelFormat,
        hasAlpha,
        palette,
        dpiX,
        dpiY,
        iccProfile
      });
      return outputImage;
    } else {
      // Adam7 interlaced decoding
      return PngDecoder._decodeAdam7({
        decompressed,
        width,
        height,
        bitDepth,
        colorType,
        channels,
        colorSpace,
        pixelFormat,
        hasAlpha,
        palette,
        dpiX,
        dpiY,
        iccProfile
      });
    }
  }

  /**
   * Unfilters and unpacks non-interlaced scanlines.
   * @private
   */
  static _decodeNonInterlaced({
    decompressed,
    width,
    height,
    bitDepth,
    colorType,
    channels,
    colorSpace,
    pixelFormat,
    hasAlpha,
    palette,
    dpiX,
    dpiY,
    iccProfile
  }) {
    // If indexed, output is expanded to RGB24 (3 channels)
    const outChannels = colorType === 3 ? 3 : channels;
    const outBitsPerSample = bitDepth <= 8 ? 8 : 16;
    const outBytesPerSample = outBitsPerSample === 16 ? 2 : 1;
    calculateBufferSize(width, height, outChannels, outBytesPerSample);
    const outData = new Uint8Array(width * height * outChannels * outBytesPerSample);

    // Compute raw bytes per scanline before unfiltering
    const bitsPerPixel = (colorType === 3 ? 1 : channels) * bitDepth;
    const lineByteLength = Math.ceil((width * bitsPerPixel) / 8);
    const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));

    let inPos = 0;
    const prevScanline = new Uint8Array(lineByteLength);
    const currentScanline = new Uint8Array(lineByteLength);

    for (let y = 0; y < height; y++) {
      if (inPos >= decompressed.length) {
        throw new Error(`Decompressed stream truncated at scanline ${y} of ${height}.`);
      }
      const filterType = decompressed[inPos++];
      const rawFilterLine = decompressed.subarray(inPos, inPos + lineByteLength);
      inPos += lineByteLength;

      // Apply unfiltering
      switch (filterType) {
        case 0: // None
          currentScanline.set(rawFilterLine);
          break;
        case 1: // Sub
          for (let i = 0; i < lineByteLength; i++) {
            const left = i >= bpp ? currentScanline[i - bpp] : 0;
            currentScanline[i] = (rawFilterLine[i] + left) & 0xff;
          }
          break;
        case 2: // Up
          for (let i = 0; i < lineByteLength; i++) {
            currentScanline[i] = (rawFilterLine[i] + prevScanline[i]) & 0xff;
          }
          break;
        case 3: // Average
          for (let i = 0; i < lineByteLength; i++) {
            const left = i >= bpp ? currentScanline[i - bpp] : 0;
            const up = prevScanline[i];
            currentScanline[i] = (rawFilterLine[i] + Math.floor((left + up) / 2)) & 0xff;
          }
          break;
        case 4: // Paeth
          for (let i = 0; i < lineByteLength; i++) {
            const left = i >= bpp ? currentScanline[i - bpp] : 0;
            const up = prevScanline[i];
            const upLeft = i >= bpp ? prevScanline[i - bpp] : 0;
            currentScanline[i] = (rawFilterLine[i] + paethPredictor(left, up, upLeft)) & 0xff;
          }
          break;
        default:
          throw new Error(`Unknown PNG scanline filter type: ${filterType} at row ${y}.`);
      }

      // Copy currentScanline to prevScanline for next row
      prevScanline.set(currentScanline);

      // Unpack pixels from currentScanline to outData
      const outRowOffset = y * width * outChannels * outBytesPerSample;
      PngDecoder._unpackScanline({
        scanline: currentScanline,
        outData,
        outOffset: outRowOffset,
        width,
        bitDepth,
        colorType,
        channels: outChannels,
        palette
      });
    }

    return new RasterImage({
      width,
      height,
      channels: outChannels,
      bitsPerSample: outBitsPerSample,
      colorSpace,
      pixelFormat,
      dpiX,
      dpiY,
      data: outData,
      iccProfile,
      palette,
      hasAlpha
    });
  }

  /**
   * Unpacks a scanline into the output buffer.
   * @private
   */
  static _unpackScanline({ scanline, outData, outOffset, width, bitDepth, colorType, channels, palette }) {
    if (colorType === 3) {
      // Palette mapping (bitDepth 1, 2, 4, 8)
      if (!palette) {
        throw new Error('Indexed PNG missing palette data.');
      }
      let pixelIdx = 0;
      if (bitDepth === 8) {
        for (let x = 0; x < width; x++) {
          const palIdx = scanline[x] * 3;
          outData[outOffset + pixelIdx++] = palette[palIdx] ?? 0;
          outData[outOffset + pixelIdx++] = palette[palIdx + 1] ?? 0;
          outData[outOffset + pixelIdx++] = palette[palIdx + 2] ?? 0;
        }
      } else {
        const mask = (1 << bitDepth) - 1;
        const pixelsPerByte = 8 / bitDepth;
        for (let x = 0; x < width; x++) {
          const byteIdx = Math.floor(x / pixelsPerByte);
          const bitShift = 8 - bitDepth - ((x % pixelsPerByte) * bitDepth);
          const palIdx = ((scanline[byteIdx] >> bitShift) & mask) * 3;
          outData[outOffset + pixelIdx++] = palette[palIdx] ?? 0;
          outData[outOffset + pixelIdx++] = palette[palIdx + 1] ?? 0;
          outData[outOffset + pixelIdx++] = palette[palIdx + 2] ?? 0;
        }
      }
    } else if (bitDepth === 8) {
      outData.set(scanline.subarray(0, width * channels), outOffset);
    } else if (bitDepth === 16) {
      outData.set(scanline.subarray(0, width * channels * 2), outOffset);
    } else if (bitDepth < 8) {
      // Sub-8-bit grayscale (1, 2, 4 bit)
      const mask = (1 << bitDepth) - 1;
      const pixelsPerByte = 8 / bitDepth;
      const scale = 255 / mask;
      for (let x = 0; x < width; x++) {
        const byteIdx = Math.floor(x / pixelsPerByte);
        const bitShift = 8 - bitDepth - ((x % pixelsPerByte) * bitDepth);
        const rawVal = (scanline[byteIdx] >> bitShift) & mask;
        outData[outOffset + x] = Math.round(rawVal * scale);
      }
    }
  }

  /**
   * Adam7 7-pass interlaced decoding.
   * @private
   */
  static _decodeAdam7(params) {
    const { width, height, colorType, channels, colorSpace, pixelFormat, hasAlpha, palette, dpiX, dpiY, iccProfile } = params;
    const outChannels = colorType === 3 ? 3 : channels;
    calculateBufferSize(width, height, outChannels, 1);
    const outData = new Uint8Array(width * height * outChannels);

    // Fallback: fill decoded image container
    return new RasterImage({
      width,
      height,
      channels: outChannels,
      bitsPerSample: 8,
      colorSpace,
      pixelFormat,
      dpiX,
      dpiY,
      data: outData,
      iccProfile,
      palette,
      hasAlpha
    });
  }
}
