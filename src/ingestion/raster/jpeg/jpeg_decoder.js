/**
 * @file jpeg_decoder.js
 * @description Pure native baseline JPEG decoder for Poltergeist.
 * Zero-dependency, memory-safe, supports JFIF DPI extraction,
 * multi-part APP2 ICC profile assembly, and Adobe YCCK/CMYK conversion.
 */

import { RasterImage, PixelFormat, ColorSpaceType, calculateBufferSize } from '../../../types/image.js';
import { IccProfile } from '../../../color/icc/profile.js';

// Standard 8x8 Zig-Zag scan order
const ZIGZAG = new Uint8Array([
   0,  1,  5,  6, 14, 15, 27, 28,
   2,  4,  7, 13, 16, 26, 29, 42,
   3,  8, 12, 17, 25, 30, 41, 43,
   9, 11, 18, 24, 31, 40, 44, 53,
  10, 19, 23, 32, 39, 45, 52, 54,
  20, 22, 33, 38, 46, 51, 55, 60,
  21, 34, 37, 47, 50, 56, 59, 61,
  35, 36, 48, 49, 57, 58, 62, 63
]);

/**
 * 8x8 Inverse Discrete Cosine Transform (AAN algorithm / standard 2D IDCT).
 * @param {Float64Array} block 64 coefficients
 * @param {Uint8Array} out 64 pixel values clamped to 0..255
 */
export function idct8x8(block, out) {
  const temp = new Float64Array(64);

  // Horizontal IDCT
  for (let y = 0; y < 8; y++) {
    const y8 = y * 8;
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) {
        const cu = u === 0 ? 0.7071067811865475 : 1.0;
        sum += cu * block[y8 + u] * Math.cos(((2 * x + 1) * u * Math.PI) / 16.0);
      }
      temp[y8 + x] = 0.5 * sum;
    }
  }

  // Vertical IDCT
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) {
        const cv = v === 0 ? 0.7071067811865475 : 1.0;
        sum += cv * temp[v * 8 + x] * Math.cos(((2 * y + 1) * v * Math.PI) / 16.0);
      }
      const val = Math.round(0.5 * sum + 128.0);
      out[y * 8 + x] = val < 0 ? 0 : val > 255 ? 255 : val;
    }
  }
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

  readBit() {
    if (this.bitsLeft === 0) {
      this.loadByte();
    }
    this.bitsLeft--;
    return (this.bitBuf >> this.bitsLeft) & 1;
  }

  readBits(count) {
    let result = 0;
    for (let i = 0; i < count; i++) {
      result = (result << 1) | this.readBit();
    }
    return result;
  }

  loadByte() {
    if (this.offset >= this.buffer.length) {
      this.bitBuf = 0;
      this.bitsLeft = 8;
      return;
    }
    let b = this.buffer[this.offset++];
    if (b === 0xff) {
      if (this.offset < this.buffer.length) {
        const next = this.buffer[this.offset];
        if (next === 0x00) {
          this.offset++; // Skip stuffed zero
        }
      }
    }
    this.bitBuf = b;
    this.bitsLeft = 8;
  }

  decodeHuffman(table) {
    if (!table) return 0;
    // Lookahead 8 bits
    while (this.bitsLeft < 8 && this.offset < this.buffer.length) {
      let b = this.buffer[this.offset++];
      if (b === 0xff && this.offset < this.buffer.length && this.buffer[this.offset] === 0x00) {
        this.offset++;
      }
      this.bitBuf = (this.bitBuf << 8) | b;
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
   * @param {Uint8Array|Buffer} buffer 
   * @returns {RasterImage}
   */
  static decode(buffer) {
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
          iccChunks
        });
      }
    }

    throw new Error('JPEG stream truncated before SOS scan data.');
  }

  /**
   * Decodes MCU blocks and produces output RasterImage.
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
    iccChunks
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

    // Component planes in memory
    const planes = components.map(c => new Uint8Array(mcusX * c.hFactor * 8 * mcusY * c.vFactor * 8));
    const prevDc = new Int32Array(numComponents);

    const blockCoeffs = new Float64Array(64);
    const blockPixels = new Uint8Array(64);

    // Decode all MCUs
    for (let my = 0; my < mcusY; my++) {
      for (let mx = 0; mx < mcusX; mx++) {
        for (let c = 0; c < numComponents; c++) {
          const comp = components[c];
          const qTable = qTables[comp.qTableIdx] || qTables[0];
          const dcTable = dcTables[comp.dcTableIdx] || dcTables[0];
          const acTable = acTables[comp.acTableIdx] || acTables[0];
          const plane = planes[c];
          const planeStride = mcusX * comp.hFactor * 8;

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

              // IDCT
              idct8x8(blockCoeffs, blockPixels);

              // Copy block into plane
              const blockStartX = (mx * comp.hFactor + hx) * 8;
              const blockStartY = (my * comp.vFactor + vy) * 8;
              for (let by = 0; by < 8; by++) {
                const destOffset = (blockStartY + by) * planeStride + blockStartX;
                plane.set(blockPixels.subarray(by * 8, by * 8 + 8), destOffset);
              }
            }
          }
        }
      }
    }

    // Color conversion to final output image
    if (numComponents === 1) { // Grayscale
      const outData = new Uint8Array(width * height);
      const plane = planes[0];
      const planeStride = mcusX * 8;
      for (let y = 0; y < height; y++) {
        outData.set(plane.subarray(y * planeStride, y * planeStride + width), y * width);
      }
      return new RasterImage({
        width,
        height,
        channels: 1,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.GRAY,
        pixelFormat: PixelFormat.GRAY8,
        dpiX,
        dpiY,
        data: outData,
        iccProfile
      });
    } else if (numComponents === 3) { // YCbCr to RGB
      const outData = new Uint8Array(width * height * 3);
      const [planeY, planeCb, planeCr] = planes;
      const strideY = mcusX * components[0].hFactor * 8;
      const strideCb = mcusX * components[1].hFactor * 8;
      const strideCr = mcusX * components[2].hFactor * 8;
      const hRatioCb = components[0].hFactor / components[1].hFactor;
      const vRatioCb = components[0].vFactor / components[1].vFactor;

      let outIdx = 0;
      for (let y = 0; y < height; y++) {
        const yOffset = y * strideY;
        const cbOffset = Math.floor(y / vRatioCb) * strideCb;
        const crOffset = Math.floor(y / vRatioCb) * strideCr;

        for (let x = 0; x < width; x++) {
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
        width,
        height,
        channels: 3,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.RGB,
        pixelFormat: PixelFormat.RGB24,
        dpiX,
        dpiY,
        data: outData,
        iccProfile
      });
    } else if (numComponents === 4) { // CMYK or YCCK
      const outData = new Uint8Array(width * height * 4);
      const [plane0, plane1, plane2, plane3] = planes;
      const stride0 = mcusX * components[0].hFactor * 8;

      let outIdx = 0;
      for (let y = 0; y < height; y++) {
        const rowOffset = y * stride0;
        for (let x = 0; x < width; x++) {
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
        width,
        height,
        channels: 4,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.CMYK,
        pixelFormat: PixelFormat.CMYK32,
        dpiX,
        dpiY,
        data: outData,
        iccProfile
      });
    }

    throw new Error(`Unsupported JPEG component count: ${numComponents}`);
  }
}
