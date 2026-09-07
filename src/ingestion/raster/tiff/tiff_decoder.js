/**
 * @file tiff_decoder.js
 * @description Pure native TIFF 6.0 decoder for Poltergeist.
 * Supports Little-Endian (II) and Big-Endian (MM), CMYK, RGB, Grayscale,
 * Uncompressed, PackBits, Deflate, and native LZW decompression.
 */

import zlib from 'node:zlib';
import { RasterImage, PixelFormat, ColorSpaceType } from '../../../types/image.js';
import { IccProfile } from '../../../color/icc/profile.js';

// TIFF Tag IDs
const TAGS = Object.freeze({
  ImageWidth: 256,
  ImageLength: 257,
  BitsPerSample: 258,
  Compression: 259,
  PhotometricInterpretation: 262,
  StripOffsets: 273,
  Orientation: 274,
  SamplesPerPixel: 277,
  RowsPerStrip: 278,
  StripByteCounts: 279,
  XResolution: 282,
  YResolution: 283,
  PlanarConfiguration: 284,
  ResolutionUnit: 296,
  Predictor: 317,
  ColorMap: 320,
  ExtraSamples: 338,
  SampleFormat: 339,
  ICCProfile: 34675
});

/**
 * Pure native TIFF LZW bitstream reader and decompressor.
 * @param {Uint8Array} input 
 * @param {number} maxExpectedLength 
 * @returns {Uint8Array}
 */
export function decompressTiffLzw(input, maxExpectedLength) {
  let bitPos = 0;
  const inputBits = input.length * 8;

  function readBits(count) {
    if (bitPos + count > inputBits) return -1;
    let val = 0;
    for (let i = 0; i < count; i++) {
      const byteIdx = (bitPos + i) >> 3;
      const bitOffset = 7 - ((bitPos + i) & 7);
      const bit = (input[byteIdx] >> bitOffset) & 1;
      val = (val << 1) | bit;
    }
    bitPos += count;
    return val;
  }

  const out = [];
  let codeSize = 9;
  let nextCode = 258;

  // Initialize dictionary (0-255 are literals, 256=Clear, 257=EOI)
  let dict = new Map();
  function resetDict() {
    dict.clear();
    for (let i = 0; i < 256; i++) {
      dict.set(i, [i]);
    }
    codeSize = 9;
    nextCode = 258;
  }
  resetDict();

  let oldCode = -1;

  while (bitPos < inputBits) {
    const code = readBits(codeSize);
    if (code === -1 || code === 257) {
      break; // End of Information
    }
    if (code === 256) {
      resetDict();
      oldCode = -1;
      continue;
    }

    let entry;
    if (dict.has(code)) {
      entry = dict.get(code);
    } else if (code === nextCode && oldCode !== -1) {
      const prev = dict.get(oldCode);
      entry = [...prev, prev[0]];
    } else {
      break; // Invalid or out-of-range code
    }

    for (let i = 0; i < entry.length; i++) {
      out.push(entry[i]);
    }

    if (oldCode !== -1 && nextCode < 4096) {
      const prev = dict.get(oldCode);
      dict.set(nextCode++, [...prev, entry[0]]);
      if (nextCode === 511 || nextCode === 1023 || nextCode === 2047) {
        codeSize++;
      }
    }
    oldCode = code;
  }

  return new Uint8Array(out);
}

/**
 * Pure native PackBits run-length decompressor.
 * @param {Uint8Array} input 
 * @param {number} expectedLength 
 * @returns {Uint8Array}
 */
export function decompressPackBits(input, expectedLength) {
  const out = new Uint8Array(expectedLength);
  let inPos = 0;
  let outPos = 0;

  while (inPos < input.length && outPos < expectedLength) {
    const n = (input[inPos++] << 24) >> 24; // Sign extend to int8
    if (n >= 0) {
      const count = n + 1;
      for (let i = 0; i < count && outPos < expectedLength && inPos < input.length; i++) {
        out[outPos++] = input[inPos++];
      }
    } else if (n >= -127) {
      const count = -n + 1;
      if (inPos < input.length) {
        const val = input[inPos++];
        for (let i = 0; i < count && outPos < expectedLength; i++) {
          out[outPos++] = val;
        }
      }
    }
  }

  return out;
}

/**
 * Reverses Horizontal Differencing (Predictor 2) in-place.
 * @param {Uint8Array} data 
 * @param {number} width 
 * @param {number} height 
 * @param {number} samplesPerPixel 
 * @param {number} bytesPerSample 
 */
export function applyHorizontalPredictor(data, width, height, samplesPerPixel, bytesPerSample) {
  const stride = width * samplesPerPixel * bytesPerSample;
  if (bytesPerSample === 1) {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * stride;
      for (let x = 1; x < width; x++) {
        for (let c = 0; c < samplesPerPixel; c++) {
          const currentIdx = rowOffset + x * samplesPerPixel + c;
          const prevIdx = rowOffset + (x - 1) * samplesPerPixel + c;
          data[currentIdx] = (data[currentIdx] + data[prevIdx]) & 0xff;
        }
      }
    }
  } else if (bytesPerSample === 2) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let y = 0; y < height; y++) {
      const rowOffset = y * stride;
      for (let x = 1; x < width; x++) {
        for (let c = 0; c < samplesPerPixel; c++) {
          const currentByte = rowOffset + (x * samplesPerPixel + c) * 2;
          const prevByte = rowOffset + ((x - 1) * samplesPerPixel + c) * 2;
          const currentVal = view.getUint16(currentByte, false);
          const prevVal = view.getUint16(prevByte, false);
          view.setUint16(currentByte, (currentVal + prevVal) & 0xffff, false);
        }
      }
    }
  }
}

/**
 * Pure native TIFF Decoder.
 */
export class TiffDecoder {
  /**
   * Decodes a TIFF binary buffer into a RasterImage.
   * @param {Uint8Array|Buffer} buffer 
   * @returns {RasterImage}
   */
  static decode(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 8) {
      throw new Error(`TIFF buffer truncated: size ${bytes.length} is less than 8-byte TIFF header.`);
    }

    let isLittleEndian;
    if (bytes[0] === 0x49 && bytes[1] === 0x49) {
      isLittleEndian = true;
    } else if (bytes[0] === 0x4d && bytes[1] === 0x4d) {
      isLittleEndian = false;
    } else {
      throw new Error(`Invalid TIFF byte order indicator: 0x${bytes[0].toString(16)} 0x${bytes[1].toString(16)}. Expected 'II' or 'MM'.`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = view.getUint16(2, isLittleEndian);
    if (magic !== 42) {
      throw new Error(`Invalid TIFF magic number: ${magic}. Expected 42.`);
    }

    let ifdOffset = view.getUint32(4, isLittleEndian);
    if (ifdOffset >= bytes.length || ifdOffset < 8) {
      throw new Error(`Invalid initial IFD offset: ${ifdOffset}.`);
    }

    // Read First IFD
    const numEntries = view.getUint16(ifdOffset, isLittleEndian);
    ifdOffset += 2;

    const tags = new Map();

    for (let i = 0; i < numEntries; i++) {
      if (ifdOffset + 12 > bytes.length) break;
      const entryPos = ifdOffset;
      const tagId = view.getUint16(ifdOffset, isLittleEndian);
      const tagType = view.getUint16(ifdOffset + 2, isLittleEndian);
      const count = view.getUint32(ifdOffset + 4, isLittleEndian);
      const valOrOffset = view.getUint32(ifdOffset + 8, isLittleEndian);
      ifdOffset += 12;

      tags.set(tagId, { tagType, count, valOrOffset, valueOffset: entryPos + 8 });
    }

    // Helper to read tag value array
    function readTagValues(tagId, defaultVal = []) {
      if (!tags.has(tagId)) return defaultVal;
      const tagInfo = tags.get(tagId);
      const { tagType, count, valOrOffset, valueOffset } = tagInfo;
      if (count === 0) return defaultVal;

      let typeSize = 1;
      if (tagType === 3) typeSize = 2; // SHORT
      else if (tagType === 4) typeSize = 4; // LONG
      else if (tagType === 5) typeSize = 8; // RATIONAL

      const totalBytes = count * typeSize;
      const currentOffset = totalBytes <= 4 ? valueOffset : valOrOffset;

      if (currentOffset + totalBytes > bytes.length) {
        return defaultVal;
      }

      const result = [];

      for (let i = 0; i < count; i++) {
        if (tagType === 1) { // BYTE
          result.push(bytes[currentOffset + i]);
        } else if (tagType === 3) { // SHORT
          result.push(view.getUint16(currentOffset + i * 2, isLittleEndian));
        } else if (tagType === 4) { // LONG
          result.push(view.getUint32(currentOffset + i * 4, isLittleEndian));
        } else if (tagType === 5) { // RATIONAL (numerator/denominator)
          const num = view.getUint32(currentOffset + i * 8, isLittleEndian);
          const den = view.getUint32(currentOffset + i * 8 + 4, isLittleEndian);
          result.push(den !== 0 ? num / den : 0);
        }
      }
      return result;
    }

    function readTagSingle(tagId, defaultVal = 0) {
      const vals = readTagValues(tagId, [defaultVal]);
      return vals.length > 0 ? vals[0] : defaultVal;
    }

    const width = readTagSingle(TAGS.ImageWidth, 0);
    const height = readTagSingle(TAGS.ImageLength, 0);
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid TIFF image dimensions: ${width}x${height}`);
    }

    const samplesPerPixel = readTagSingle(TAGS.SamplesPerPixel, 1);
    const bitsPerSampleArr = readTagValues(TAGS.BitsPerSample, [8]);
    const bitsPerSample = bitsPerSampleArr[0] || 8;
    const compression = readTagSingle(TAGS.Compression, 1);
    const photometric = readTagSingle(TAGS.PhotometricInterpretation, 2);
    const predictor = readTagSingle(TAGS.Predictor, 1);
    const rowsPerStrip = readTagSingle(TAGS.RowsPerStrip, height);

    const stripOffsets = readTagValues(TAGS.StripOffsets, []);
    const stripByteCounts = readTagValues(TAGS.StripByteCounts, []);

    // Resolution tags
    const xRes = readTagSingle(TAGS.XResolution, 300);
    const yRes = readTagSingle(TAGS.YResolution, 300);
    const resUnit = readTagSingle(TAGS.ResolutionUnit, 2); // 2 = inch, 3 = cm
    const dpiX = Math.round(resUnit === 3 ? xRes * 2.54 : xRes);
    const dpiY = Math.round(resUnit === 3 ? yRes * 2.54 : yRes);

    // Embedded ICC Profile
    let iccProfile = null;
    if (tags.has(TAGS.ICCProfile)) {
      try {
        const { count, valOrOffset } = tags.get(TAGS.ICCProfile);
        const iccData = bytes.subarray(valOrOffset, valOrOffset + count);
        iccProfile = IccProfile.fromBuffer(iccData);
      } catch {
        // Continue if profile is malformed
      }
    }

    // Determine color space and pixel format
    let colorSpace = ColorSpaceType.RGB;
    let pixelFormat = PixelFormat.RGB24;
    let hasAlpha = false;

    if (photometric === 5) { // CMYK
      colorSpace = ColorSpaceType.CMYK;
      pixelFormat = bitsPerSample === 16 ? PixelFormat.CMYK64 : PixelFormat.CMYK32;
    } else if (photometric === 0 || photometric === 1) { // Grayscale
      colorSpace = ColorSpaceType.GRAY;
      pixelFormat = bitsPerSample === 16 ? PixelFormat.GRAY16 : PixelFormat.GRAY8;
    } else if (photometric === 2) { // RGB
      colorSpace = ColorSpaceType.RGB;
      if (samplesPerPixel === 4) {
        hasAlpha = true;
        pixelFormat = bitsPerSample === 16 ? PixelFormat.RGBA64 : PixelFormat.RGBA32;
      } else {
        pixelFormat = bitsPerSample === 16 ? PixelFormat.RGB48 : PixelFormat.RGB24;
      }
    }

    const bytesPerSample = bitsPerSample === 16 ? 2 : 1;
    const rowStride = width * samplesPerPixel * bytesPerSample;
    const totalImageBytes = rowStride * height;
    const outData = new Uint8Array(totalImageBytes);

    // Decompress and assemble strips
    let currentY = 0;
    for (let s = 0; s < stripOffsets.length; s++) {
      const offset = stripOffsets[s];
      const byteCount = stripByteCounts[s] || (bytes.length - offset);
      if (offset + byteCount > bytes.length) {
        throw new Error(`Strip ${s} offset ${offset} + byteCount ${byteCount} exceeds buffer size.`);
      }

      const stripRaw = bytes.subarray(offset, offset + byteCount);
      const rowsInThisStrip = Math.min(rowsPerStrip, height - currentY);
      const expectedStripBytes = rowsInThisStrip * rowStride;

      let decompressedStrip;
      if (compression === 1) { // Uncompressed
        decompressedStrip = stripRaw.subarray(0, expectedStripBytes);
      } else if (compression === 32773) { // PackBits
        decompressedStrip = decompressPackBits(stripRaw, expectedStripBytes);
      } else if (compression === 8 || compression === 32946) { // Deflate
        decompressedStrip = zlib.inflateSync(stripRaw);
      } else if (compression === 5) { // LZW
        decompressedStrip = decompressTiffLzw(stripRaw, expectedStripBytes);
      } else {
        throw new Error(`Unsupported TIFF compression method: ${compression}`);
      }

      const stripDestOffset = currentY * rowStride;
      const copyLen = Math.min(decompressedStrip.length, expectedStripBytes);
      outData.set(decompressedStrip.subarray(0, copyLen), stripDestOffset);

      currentY += rowsInThisStrip;
      if (currentY >= height) break;
    }

    // Apply horizontal differencing predictor reversal if needed
    if (predictor === 2) {
      applyHorizontalPredictor(outData, width, height, samplesPerPixel, bytesPerSample);
    }

    return new RasterImage({
      width,
      height,
      channels: samplesPerPixel,
      bitsPerSample,
      colorSpace,
      pixelFormat,
      dpiX,
      dpiY,
      data: outData,
      iccProfile,
      hasAlpha
    });
  }
}
