/**
 * @file jpeg_decoder.js
 * @description Pure native baseline JPEG decoder for Poltergeist.
 * Zero-dependency, memory-safe, supports JFIF DPI extraction,
 * multi-part APP2 ICC profile assembly, and Adobe YCCK/CMYK conversion.
 */

import { RasterImage, PixelFormat, ColorSpaceType, calculateBufferSize } from '../../../types/image.js';
import { IccProfile } from '../../../color/icc/profile.js';
import { fastIdct8x8, idct4x4, idct2x2, idct1x1, wasmIdct } from './idct_wasm.js';

// Standard 8x8 Zig-Zag scan order (ITU-T T.81 Figure A.6)
const ZIGZAG = new Uint8Array([
   0,  1,  8, 16,  9,  2,  3, 10,
  17, 24, 32, 25, 18, 11,  4,  5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13,  6,  7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63
]);

/**
 * 8x8 Inverse Discrete Cosine Transform.
 * Uses precomputed cosine basis vectors and reusable buffers.
 * @param {Float64Array} block 64 coefficients
 * @param {Uint8Array} out 64 pixel values clamped to 0..255
 */
export function idct8x8(block, out) {
  fastIdct8x8(block, out);
}

/**
 * Pure native Huffman Decoder for JPEG.
 */
class JpegHuffmanTable {
  constructor() {
    this.bits = new Uint8Array(17);
    this.huffval = new Uint8Array(256);
    this.lookahead = new Int32Array(256);
    this.mincode = new Int32Array(17);
    this.maxcode = new Int32Array(17);
    this.valptr = new Int32Array(17);
  }

  generate() {
    this.lookahead.fill(-1);
    let p = 0;
    let code = 0;
    for (let l = 1; l <= 16; l++) {
      this.mincode[l] = code;
      this.valptr[l] = p;
      const count = this.bits[l];
      if (count === 0) {
        this.maxcode[l] = -1;
      } else {
        this.maxcode[l] = code + count - 1;
        for (let i = 0; i < count; i++) {
          const val = this.huffval[p + i];
          if (l <= 8) {
            const shift = 8 - l;
            const fill = 1 << shift;
            for (let j = 0; j < fill; j++) {
              this.lookahead[(code << shift) | j] = (l << 8) | val;
            }
          }
          code++;
        }
        p += count;
      }
      code <<= 1;
    }
  }
}

/**
 * Entropy bitstream reader handling JPEG 0xFF00 byte-stuffing.
 */
class JpegBitReader {
  constructor(buffer, offset) {
    this.buffer = buffer;
    this.offset = offset;
    this.bitBuf = 0;
    this.bitsLeft = 0;
  }

  _loadByte() {
    if (this.offset >= this.buffer.length) {
      return -1;
    }
    let b = this.buffer[this.offset++];
    if (b === 0xff) {
      while (this.offset < this.buffer.length && this.buffer[this.offset] === 0xff) {
        this.offset++;
      }
      if (this.offset < this.buffer.length) {
        const next = this.buffer[this.offset];
        if (next === 0x00) {
          this.offset++; // Skip stuffed zero
          return 0xff;
        }
        if ((next >= 0xd0 && next <= 0xd7) || next === 0xd9) {
          // Restart marker or EOI encountered; stop loading into bitBuf
          this.offset--;
          return -1;
        }
      }
    }
    return b;
  }

  readBit() {
    if (this.bitsLeft === 0) {
      const b = this._loadByte();
      if (b === -1) {
        return 0;
      }
      this.bitBuf = b;
      this.bitsLeft = 8;
    }
    this.bitsLeft--;
    return (this.bitBuf >>> this.bitsLeft) & 1;
  }

  readBits(count) {
    if (count === 0) return 0;
    while (this.bitsLeft < count) {
      const b = this._loadByte();
      if (b === -1) break;
      this.bitBuf = ((this.bitBuf << 8) | b) >>> 0;
      this.bitsLeft += 8;
    }
    if (this.bitsLeft < count) {
      const v = (this.bitBuf << (count - this.bitsLeft)) & ((1 << count) - 1);
      this.bitsLeft = 0;
      return v;
    }
    this.bitsLeft -= count;
    return (this.bitBuf >>> this.bitsLeft) & ((1 << count) - 1);
  }

  decodeHuffman(table) {
    if (!table) return 0;
    // Lookahead 8 bits
    while (this.bitsLeft < 8) {
      const b = this._loadByte();
      if (b === -1) break;
      this.bitBuf = ((this.bitBuf << 8) | b) >>> 0;
      this.bitsLeft += 8;
    }

    if (this.bitsLeft >= 8) {
      const idx = (this.bitBuf >> (this.bitsLeft - 8)) & 0xff;
      const entry = table.lookahead[idx];
      if (entry >= 0) {
        const len = entry >> 8;
        const val = entry & 0xff;
        this.bitsLeft -= len;
        return val;
      }
    }

    // Slow path for codes > 8 bits
    let code = 0;
    for (let l = 1; l <= 16; l++) {
      code = (code << 1) | this.readBit();
      if (code <= table.maxcode[l]) {
        const p = table.valptr[l] + (code - table.mincode[l]);
        return table.huffval[p];
      }
    }
    return 0; // Huffman decode error recovery
  }

  skipRestartMarker() {
    this.bitsLeft = 0;
    this.bitBuf = 0;
    while (this.offset < this.buffer.length && this.buffer[this.offset] !== 0xff) {
      this.offset++;
    }
    while (this.offset < this.buffer.length && this.buffer[this.offset] === 0xff) {
      this.offset++;
    }
    if (this.offset < this.buffer.length && this.buffer[this.offset] >= 0xd0 && this.buffer[this.offset] <= 0xd7) {
      this.offset++;
    }
  }

  receiveExtend(length) {
    if (length === 0) return 0;
    const v = this.readBits(length);
    if (v < (1 << (length - 1))) {
      return v + ((-1) << length) + 1;
    }
    return v;
  }
}

/**
 * Pure native JPEG Decoder.
 */
export class JpegDecoder {
  /**
   * Decodes a JPEG binary buffer into a RasterImage.
   * Supports optional scaleDenom (1, 2, 4, 8) for high-performance scaled IDCT decoding.
   * @param {Uint8Array|Buffer} buffer 
   * @param {object} [options]
   * @param {number} [options.scaleDenom=1] Spatial scaling denominator (1=full, 2=1/2, 4=1/4, 8=1/8)
   * @param {number} [options.targetDpi] Optional target DPI used to select optimal scaleDenom
   * @param {number} [options.targetWidth] Optional target width used to select optimal scaleDenom
   * @returns {RasterImage}
   */
  static decode(buffer, options = {}) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error('Invalid JPEG stream: SOI marker 0xFFD8 not found.');
    }

    let offset = 2;
    let width = 0;
    let height = 0;
    let numComponents = 0;
    let dpiX = 300;
    let dpiY = 300;
    let adobeTransform = null; // 0=CMYK, 1=YCbCr, 2=YCCK
    let restartInterval = 0;

    const qTables = [];
    const dcTables = [];
    const acTables = [];
    const components = [];
    const iccChunks = new Map();

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) {
        offset++;
      }
      if (offset >= bytes.length) break;

      const marker = bytes[offset++];
      if (marker === 0xd9) break; // EOI
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // Standalone markers

      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset, false);
      const payloadStart = offset + 2;
      const payloadEnd = offset + length;
      offset = payloadEnd;

      if (payloadEnd > bytes.length) {
        throw new Error(`JPEG marker 0xFF${marker.toString(16)} declared length ${length} extends beyond buffer bounds.`);
      }

      if (marker === 0xe0) { // APP0 JFIF
        if (length >= 16) {
          const id = String.fromCharCode(bytes[payloadStart], bytes[payloadStart + 1], bytes[payloadStart + 2], bytes[payloadStart + 3]);
          if (id === 'JFIF') {
            const unit = bytes[payloadStart + 7];
            const xDensity = view.getUint16(payloadStart + 8, false);
            const yDensity = view.getUint16(payloadStart + 10, false);
            if (unit === 1) { // Dots per inch
              dpiX = xDensity || 300;
              dpiY = yDensity || 300;
            } else if (unit === 2) { // Dots per cm
              dpiX = Math.round(xDensity * 2.54) || 300;
              dpiY = Math.round(yDensity * 2.54) || 300;
            }
          }
        }
      } else if (marker === 0xe2) { // APP2 ICC Profile
        if (length >= 14) {
          const id = String.fromCharCode(...bytes.subarray(payloadStart, payloadStart + 11));
          if (id.startsWith('ICC_PROFILE')) {
            const seq = bytes[payloadStart + 12];
            const chunkData = bytes.subarray(payloadStart + 14, payloadEnd);
            iccChunks.set(seq, chunkData);
          }
        }
      } else if (marker === 0xee) { // APP14 Adobe
        if (length >= 14) {
          const id = String.fromCharCode(...bytes.subarray(payloadStart, payloadStart + 5));
          if (id === 'Adobe') {
            adobeTransform = bytes[payloadStart + 11];
          }
        }
      } else if (marker === 0xdb) { // DQT
        let pos = payloadStart;
        while (pos < payloadEnd) {
          const qInfo = bytes[pos++];
          const tableIdx = qInfo & 0x0f;
          const precision = qInfo >> 4; // 0=8-bit, 1=16-bit
          const table = new Float64Array(64);
          for (let i = 0; i < 64; i++) {
            table[ZIGZAG[i]] = precision === 0 ? bytes[pos++] : view.getUint16(pos += 2, false);
          }
          qTables[tableIdx] = table;
        }
      } else if (marker === 0xdd) { // DRI Define Restart Interval
        restartInterval = view.getUint16(payloadStart, false);
      } else if (marker === 0xc0) { // SOF0 Baseline DCT
        height = view.getUint16(payloadStart + 1, false);
        width = view.getUint16(payloadStart + 3, false);
        numComponents = bytes[payloadStart + 5];
        calculateBufferSize(width, height, numComponents, 1);
        let pos = payloadStart + 6;
        for (let i = 0; i < numComponents; i++) {
          const id = bytes[pos++];
          const factors = bytes[pos++];
          const qTableIdx = bytes[pos++];
          components.push({
            id,
            hFactor: factors >> 4,
            vFactor: factors & 0x0f,
            qTableIdx
          });
        }
      } else if (marker === 0xc4) { // DHT
        let pos = payloadStart;
        while (pos < payloadEnd) {
          const hInfo = bytes[pos++];
          const isAc = (hInfo >> 4) === 1;
          const tableIdx = hInfo & 0x0f;
          const table = new JpegHuffmanTable();
          let count = 0;
          for (let i = 1; i <= 16; i++) {
            table.bits[i] = bytes[pos++];
            count += table.bits[i];
          }
          for (let i = 0; i < count; i++) {
            table.huffval[i] = bytes[pos++];
          }
          table.generate();
          if (isAc) {
            acTables[tableIdx] = table;
          } else {
            dcTables[tableIdx] = table;
          }
        }
      } else if (marker === 0xda) { // SOS Start of Scan
        // Scan header
        const scanCompCount = bytes[payloadStart];
        let pos = payloadStart + 1;
        for (let i = 0; i < scanCompCount; i++) {
          const compId = bytes[pos++];
          const tableSelectors = bytes[pos++];
          const comp = components.find(c => c.id === compId);
          if (comp) {
            comp.dcTableIdx = tableSelectors >> 4;
            comp.acTableIdx = tableSelectors & 0x0f;
          }
        }

        // Start decoding entropy-coded scan data
        const scanDataOffset = payloadEnd;
        const bitReader = new JpegBitReader(bytes, scanDataOffset);

        let scaleDenom = 1;
        if (options && typeof options === 'object') {
          if (options.scaleDenom === 2 || options.scaleDenom === 4 || options.scaleDenom === 8) {
            scaleDenom = options.scaleDenom;
          } else if (options.scale === 0.5) {
            scaleDenom = 2;
          } else if (options.scale === 0.25) {
            scaleDenom = 4;
          } else if (options.scale === 0.125) {
            scaleDenom = 8;
          } else if (options.targetDpi || options.dpi) {
            const reqDpi = options.targetDpi || options.dpi;
            const ratio = reqDpi / dpiX;
            if (ratio <= 0.15) scaleDenom = 8;
            else if (ratio <= 0.35) scaleDenom = 4;
            else if (ratio <= 0.70) scaleDenom = 2;
          } else if (options.targetWidth) {
            const ratio = options.targetWidth / width;
            if (ratio <= 0.15) scaleDenom = 8;
            else if (ratio <= 0.35) scaleDenom = 4;
            else if (ratio <= 0.70) scaleDenom = 2;
          }
        }

        return JpegDecoder._decodeScan({
          bitReader,
          width,
          height,
          components,
          qTables,
          dcTables,
          acTables,
          dpiX,
          dpiY,
          adobeTransform,
          iccChunks,
          restartInterval,
          scaleDenom
        });
      }
    }

    throw new Error('JPEG stream truncated before SOS scan data.');
  }

  /**
   * Decodes MCU blocks and produces output RasterImage.
   * Supports scaled IDCT (1, 2, 4, 8) for ultra-fast downscaled decoding.
   * @private
   */
  static _decodeScan({
    bitReader,
    width,
    height,
    components,
    qTables,
    dcTables,
    acTables,
    dpiX,
    dpiY,
    adobeTransform,
    iccChunks,
    restartInterval = 0,
    scaleDenom = 1
  }) {
    // Reconstruct ICC profile if chunks exist
    let iccProfile = null;
    if (iccChunks.size > 0) {
      try {
        const sortedKeys = Array.from(iccChunks.keys()).sort((a, b) => a - b);
        let totalLen = 0;
        for (const k of sortedKeys) totalLen += iccChunks.get(k).length;
        const fullIcc = new Uint8Array(totalLen);
        let p = 0;
        for (const k of sortedKeys) {
          const c = iccChunks.get(k);
          fullIcc.set(c, p);
          p += c.length;
        }
        iccProfile = IccProfile.fromBuffer(fullIcc);
      } catch {
        // Non-fatal
      }
    }

    const numComponents = components.length;
    let maxH = 1;
    let maxV = 1;
    for (const c of components) {
      if (c.hFactor > maxH) maxH = c.hFactor;
      if (c.vFactor > maxV) maxV = c.vFactor;
    }

    const mcuWidth = maxH * 8;
    const mcuHeight = maxV * 8;
    const mcusX = Math.ceil(width / mcuWidth);
    const mcusY = Math.ceil(height / mcuHeight);

    const blockSize = 8 / scaleDenom;
    const scaledWidth = Math.ceil(width / scaleDenom);
    const scaledHeight = Math.ceil(height / scaleDenom);
    const scaledDpiX = Math.max(1, Math.round(dpiX / scaleDenom));
    const scaledDpiY = Math.max(1, Math.round(dpiY / scaleDenom));

    let idctFn;
    let blockPixels;
    if (scaleDenom === 8) {
      idctFn = idct1x1;
      blockPixels = new Uint8Array(1);
    } else if (scaleDenom === 4) {
      idctFn = idct2x2;
      blockPixels = new Uint8Array(4);
    } else if (scaleDenom === 2) {
      idctFn = idct4x4;
      blockPixels = new Uint8Array(16);
    } else {
      idctFn = wasmIdct.isAvailable() ? (b, o) => wasmIdct.idct8x8(b, o) : fastIdct8x8;
      blockPixels = new Uint8Array(64);
    }

    // Component planes in memory (scaled to blockSize)
    const planes = components.map(c => new Uint8Array(mcusX * c.hFactor * blockSize * mcusY * c.vFactor * blockSize));
    const prevDc = new Int32Array(numComponents);

    const blockCoeffs = new Float64Array(64);

    let mcuCount = 0;

    // Decode all MCUs
    for (let my = 0; my < mcusY; my++) {
      for (let mx = 0; mx < mcusX; mx++) {
        if (restartInterval > 0 && mcuCount > 0 && (mcuCount % restartInterval) === 0) {
          bitReader.skipRestartMarker();
          prevDc.fill(0);
        }
        mcuCount++;

        for (let c = 0; c < numComponents; c++) {
          const comp = components[c];
          const qTable = qTables[comp.qTableIdx] || qTables[0];
          const dcTable = dcTables[comp.dcTableIdx] || dcTables[0];
          const acTable = acTables[comp.acTableIdx] || acTables[0];
          const plane = planes[c];
          const planeStride = mcusX * comp.hFactor * blockSize;

          for (let vy = 0; vy < comp.vFactor; vy++) {
            for (let hx = 0; hx < comp.hFactor; hx++) {
              blockCoeffs.fill(0);

              // Decode DC
              const dcLen = bitReader.decodeHuffman(dcTable);
              const dcDiff = bitReader.receiveExtend(dcLen);
              prevDc[c] += dcDiff;
              blockCoeffs[0] = prevDc[c] * qTable[0];

              // Decode AC
              if (acTable) {
                let k = 1;
                while (k < 64) {
                  const rs = bitReader.decodeHuffman(acTable);
                  const r = rs >> 4; // Run length of zeros
                  const s = rs & 0x0f; // Size of non-zero coeff

                  if (s === 0) {
                    if (r === 15) {
                      k += 16; // ZRL
                    } else {
                      break; // EOB
                    }
                  } else {
                    k += r;
                    if (k < 64) {
                      const acVal = bitReader.receiveExtend(s);
                      blockCoeffs[ZIGZAG[k]] = acVal * qTable[ZIGZAG[k]];
                      k++;
                    }
                  }
                }
              }

              // IDCT (Scaled or full-resolution)
              idctFn(blockCoeffs, blockPixels);

              // Copy block into plane
              const blockStartX = (mx * comp.hFactor + hx) * blockSize;
              const blockStartY = (my * comp.vFactor + vy) * blockSize;
              for (let by = 0; by < blockSize; by++) {
                const destOffset = (blockStartY + by) * planeStride + blockStartX;
                plane.set(blockPixels.subarray(by * blockSize, by * blockSize + blockSize), destOffset);
              }
            }
          }
        }
      }
    }

    // Color conversion to final output image
    if (numComponents === 1) { // Grayscale
      const outData = new Uint8Array(scaledWidth * scaledHeight);
      const plane = planes[0];
      const planeStride = mcusX * components[0].hFactor * blockSize;
      for (let y = 0; y < scaledHeight; y++) {
        outData.set(plane.subarray(y * planeStride, y * planeStride + scaledWidth), y * scaledWidth);
      }
      return new RasterImage({
        width: scaledWidth,
        height: scaledHeight,
        channels: 1,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.GRAY,
        pixelFormat: PixelFormat.GRAY8,
        dpiX: scaledDpiX,
        dpiY: scaledDpiY,
        data: outData,
        iccProfile
      });
    } else if (numComponents === 3) { // YCbCr to RGB
      const outData = new Uint8Array(scaledWidth * scaledHeight * 3);
      const [planeY, planeCb, planeCr] = planes;
      const strideY = mcusX * components[0].hFactor * blockSize;
      const strideCb = mcusX * components[1].hFactor * blockSize;
      const strideCr = mcusX * components[2].hFactor * blockSize;
      const hRatioCb = components[0].hFactor / components[1].hFactor;
      const vRatioCb = components[0].vFactor / components[1].vFactor;

      let outIdx = 0;
      for (let y = 0; y < scaledHeight; y++) {
        const yOffset = y * strideY;
        const cbOffset = Math.floor(y / vRatioCb) * strideCb;
        const crOffset = Math.floor(y / vRatioCb) * strideCr;

        for (let x = 0; x < scaledWidth; x++) {
          const Y = planeY[yOffset + x];
          const cbX = Math.floor(x / hRatioCb);
          const Cb = planeCb[cbOffset + cbX] - 128;
          const Cr = planeCr[crOffset + cbX] - 128;

          const r = Math.round(Y + 1.402 * Cr);
          const g = Math.round(Y - 0.344136 * Cb - 0.714136 * Cr);
          const b = Math.round(Y + 1.772 * Cb);

          outData[outIdx++] = r < 0 ? 0 : r > 255 ? 255 : r;
          outData[outIdx++] = g < 0 ? 0 : g > 255 ? 255 : g;
          outData[outIdx++] = b < 0 ? 0 : b > 255 ? 255 : b;
        }
      }

      return new RasterImage({
        width: scaledWidth,
        height: scaledHeight,
        channels: 3,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.RGB,
        pixelFormat: PixelFormat.RGB24,
        dpiX: scaledDpiX,
        dpiY: scaledDpiY,
        data: outData,
        iccProfile
      });
    } else if (numComponents === 4) { // CMYK or YCCK
      const outData = new Uint8Array(scaledWidth * scaledHeight * 4);
      const [plane0, plane1, plane2, plane3] = planes;
      const stride0 = mcusX * components[0].hFactor * blockSize;

      let outIdx = 0;
      for (let y = 0; y < scaledHeight; y++) {
        const rowOffset = y * stride0;
        for (let x = 0; x < scaledWidth; x++) {
          if (adobeTransform === 2) { // YCCK -> CMYK
            const Y = plane0[rowOffset + x];
            const Cb = plane1[rowOffset + x] - 128;
            const Cr = plane2[rowOffset + x] - 128;
            const K = plane3[rowOffset + x];

            const r = Math.round(Y + 1.402 * Cr);
            const g = Math.round(Y - 0.344136 * Cb - 0.714136 * Cr);
            const b = Math.round(Y + 1.772 * Cb);

            outData[outIdx++] = 255 - (r < 0 ? 0 : r > 255 ? 255 : r);
            outData[outIdx++] = 255 - (g < 0 ? 0 : g > 255 ? 255 : g);
            outData[outIdx++] = 255 - (b < 0 ? 0 : b > 255 ? 255 : b);
            outData[outIdx++] = K;
          } else { // Direct inverted CMYK
            outData[outIdx++] = 255 - plane0[rowOffset + x];
            outData[outIdx++] = 255 - plane1[rowOffset + x];
            outData[outIdx++] = 255 - plane2[rowOffset + x];
            outData[outIdx++] = 255 - plane3[rowOffset + x];
          }
        }
      }

      return new RasterImage({
        width: scaledWidth,
        height: scaledHeight,
        channels: 4,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.CMYK,
        pixelFormat: PixelFormat.CMYK32,
        dpiX: scaledDpiX,
        dpiY: scaledDpiY,
        data: outData,
        iccProfile
      });
    }

    throw new Error(`Unsupported JPEG component count: ${numComponents}`);
  }
}
