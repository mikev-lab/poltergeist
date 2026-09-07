/**
 * @file jpeg_writer.js
 * @description Pure native baseline JPEG binary serializer for Poltergeist.
 * Zero-dependency, memory-safe, supports 8-bit RGB and Grayscale,
 * JFIF DPI metadata embedding, quality scaling, and ICC APP2 markers.
 */

import { ColorSpaceType, calculateBufferSize } from '../../types/image.js';

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

// ITU-T T.81 Annex K Standard Luminance Quantization Table
const STD_LUM_Q = new Uint8Array([
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99
]);

// ITU-T T.81 Annex K Standard Chrominance Quantization Table
const STD_CHR_Q = new Uint8Array([
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99
]);

// Standard DC Luminance Huffman bits and values
const DC_LUM_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUM_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// Standard DC Chrominance Huffman bits and values
const DC_CHR_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHR_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// Standard AC Luminance Huffman bits and values
const AC_LUM_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUM_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12,
  0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16,
  0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
  0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79,
  0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
  0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4,
  0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea,
  0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
];

// Standard AC Chrominance Huffman bits and values
const AC_CHR_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHR_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21,
  0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
  0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34,
  0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38,
  0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
  0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
  0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96,
  0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2,
  0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9,
  0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
];

function buildHuffmanCodebook(bits, vals) {
  const codebook = new Map();
  let code = 0;
  let valIdx = 0;
  for (let len = 1; len <= 16; len++) {
    const count = bits[len - 1];
    for (let i = 0; i < count; i++) {
      const val = vals[valIdx++];
      codebook.set(val, { code, len });
      code++;
    }
    code <<= 1;
  }
  return codebook;
}

const DC_LUM_BOOK = buildHuffmanCodebook(DC_LUM_BITS, DC_LUM_VALS);
const DC_CHR_BOOK = buildHuffmanCodebook(DC_CHR_BITS, DC_CHR_VALS);
const AC_LUM_BOOK = buildHuffmanCodebook(AC_LUM_BITS, AC_LUM_VALS);
const AC_CHR_BOOK = buildHuffmanCodebook(AC_CHR_BITS, AC_CHR_VALS);

// Precompute 1D FDCT matrix C[u][x]
const DCT_MAT = [];
for (let u = 0; u < 8; u++) {
  DCT_MAT[u] = new Float64Array(8);
  const alpha = u === 0 ? 1 / Math.SQRT2 : 1;
  for (let x = 0; x < 8; x++) {
    DCT_MAT[u][x] = 0.5 * alpha * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
}

// 2D FDCT using separable matrix multiplication
function fdct8x8(input, output) {
  const temp = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    const y8 = y * 8;
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) {
        sum += input[y8 + x] * DCT_MAT[u][x];
      }
      temp[y8 + u] = sum;
    }
  }
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) {
        sum += DCT_MAT[v][y] * temp[y * 8 + u];
      }
      output[v * 8 + u] = sum;
    }
  }
}

// BitWriter with byte stuffing (0xFF -> 0xFF 0x00)
class BitWriter {
  constructor(initialCap = 65536) {
    this.buffer = new Uint8Array(initialCap);
    this.pos = 0;
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  _ensure(size) {
    if (this.pos + size > this.buffer.length) {
      const next = new Uint8Array(Math.max(this.buffer.length * 2, this.pos + size));
      next.set(this.buffer);
      this.buffer = next;
    }
  }

  writeByte(b) {
    this._ensure(2);
    this.buffer[this.pos++] = b;
    if (b === 0xff) {
      this.buffer[this.pos++] = 0x00;
    }
  }

  writeRawByte(b) {
    this._ensure(1);
    this.buffer[this.pos++] = b;
  }

  writeRawBytes(bytes) {
    this._ensure(bytes.length);
    this.buffer.set(bytes, this.pos);
    this.pos += bytes.length;
  }

  writeBits(bits, len) {
    this.bitBuf = (this.bitBuf << len) | (bits & ((1 << len) - 1));
    this.bitCount += len;
    while (this.bitCount >= 8) {
      this.bitCount -= 8;
      const b = (this.bitBuf >> this.bitCount) & 0xff;
      this.writeByte(b);
    }
  }

  flush() {
    if (this.bitCount > 0) {
      const b = (this.bitBuf << (8 - this.bitCount)) & 0xff;
      this.writeByte(b);
      this.bitBuf = 0;
      this.bitCount = 0;
    }
  }

  getUint8Array() {
    return this.buffer.subarray(0, this.pos);
  }
}

function getMagnitudeBits(val) {
  if (val === 0) return { cat: 0, bits: 0 };
  const absVal = Math.abs(val);
  const cat = 32 - Math.clz32(absVal);
  const bits = val < 0 ? val + (1 << cat) - 1 : val;
  return { cat, bits };
}

function scaleQuantTable(baseTable, quality) {
  const q = Math.max(1, Math.min(100, quality));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  const table = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    let val = Math.floor((baseTable[i] * scale + 50) / 100);
    if (val < 1) val = 1;
    if (val > 255) val = 255;
    table[i] = val;
  }
  return table;
}

export class JpegWriter {
  /**
   * Serializes a RasterImage into a standard baseline JPEG buffer.
   * @param {import('../../types/image.js').RasterImage} image 
   * @param {object} [options]
   * @param {number} [options.quality=85] Compression quality (1..100)
   * @param {number} [options.dpiX=72] Horizontal DPI
   * @param {number} [options.dpiY=72] Vertical DPI
   * @returns {Uint8Array}
   */
  static write(image, options = {}) {
    if (!image || !image.data) {
      throw new Error('Invalid raster image provided to JpegWriter.');
    }

    const { width, height, data, channels, colorSpace } = image;
    calculateBufferSize(width, height, channels, 1);

    const isGray = colorSpace === ColorSpaceType.GRAY || channels === 1;
    const quality = options.quality ?? 85;
    const dpiX = options.dpiX ?? options.dpi ?? image.dpiX ?? 72;
    const dpiY = options.dpiY ?? options.dpi ?? image.dpiY ?? 72;

    const lumQ = scaleQuantTable(STD_LUM_Q, quality);
    const chrQ = scaleQuantTable(STD_CHR_Q, quality);

    const writer = new BitWriter(Math.max(4096, Math.floor(width * height * (isGray ? 0.5 : 1.5))));

    // 1. SOI (0xFFD8)
    writer.writeRawByte(0xff); writer.writeRawByte(0xd8);

    // 2. APP0 JFIF (0xFFE0)
    writer.writeRawByte(0xff); writer.writeRawByte(0xe0);
    writer.writeRawByte(0x00); writer.writeRawByte(0x10); // Length = 16
    writer.writeRawBytes(new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0x00])); // 'JFIF\0'
    writer.writeRawByte(0x01); writer.writeRawByte(0x02); // v1.2
    writer.writeRawByte(0x01); // Units = DPI
    writer.writeRawByte((dpiX >> 8) & 0xff); writer.writeRawByte(dpiX & 0xff);
    writer.writeRawByte((dpiY >> 8) & 0xff); writer.writeRawByte(dpiY & 0xff);
    writer.writeRawByte(0x00); writer.writeRawByte(0x00); // Thumb w, h = 0

    // 3. Optional APP2 ICC Profile Marker
    if (image.iccProfile && image.iccProfile.buffer) {
      const iccBytes = image.iccProfile.buffer;
      const iccLen = 14 + iccBytes.length;
      if (iccLen <= 65535) {
        writer.writeRawByte(0xff); writer.writeRawByte(0xe2);
        writer.writeRawByte((iccLen >> 8) & 0xff); writer.writeRawByte(iccLen & 0xff);
        writer.writeRawBytes(new Uint8Array([0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00])); // 'ICC_PROFILE\0'
        writer.writeRawByte(0x01); // Chunk 1
        writer.writeRawByte(0x01); // Total 1 chunk
        writer.writeRawBytes(iccBytes);
      }
    }

    // 4. DQT (0xFFDB) Quantization Tables
    writer.writeRawByte(0xff); writer.writeRawByte(0xdb);
    writer.writeRawByte(0x00); writer.writeRawByte(67);
    writer.writeRawByte(0x00); // Table 0
    for (let i = 0; i < 64; i++) {
      writer.writeRawByte(lumQ[ZIGZAG[i]]);
    }

    if (!isGray) {
      writer.writeRawByte(0xff); writer.writeRawByte(0xdb);
      writer.writeRawByte(0x00); writer.writeRawByte(67);
      writer.writeRawByte(0x01); // Table 1
      for (let i = 0; i < 64; i++) {
        writer.writeRawByte(chrQ[ZIGZAG[i]]);
      }
    }

    // 5. SOF0 (0xFFC0) Baseline DCT
    const numComps = isGray ? 1 : 3;
    writer.writeRawByte(0xff); writer.writeRawByte(0xc0);
    const sofLen = 8 + numComps * 3;
    writer.writeRawByte((sofLen >> 8) & 0xff); writer.writeRawByte(sofLen & 0xff);
    writer.writeRawByte(8); // Precision = 8-bit
    writer.writeRawByte((height >> 8) & 0xff); writer.writeRawByte(height & 0xff);
    writer.writeRawByte((width >> 8) & 0xff); writer.writeRawByte(width & 0xff);
    writer.writeRawByte(numComps);

    if (isGray) {
      writer.writeRawByte(1); writer.writeRawByte(0x11); writer.writeRawByte(0);
    } else {
      writer.writeRawByte(1); writer.writeRawByte(0x11); writer.writeRawByte(0); // Y
      writer.writeRawByte(2); writer.writeRawByte(0x11); writer.writeRawByte(1); // Cb
      writer.writeRawByte(3); writer.writeRawByte(0x11); writer.writeRawByte(1); // Cr
    }

    // 6. DHT (0xFFC4) Huffman Tables
    function writeDHT(tableClass, tableId, bits, vals) {
      writer.writeRawByte(0xff); writer.writeRawByte(0xc4);
      const len = 3 + 16 + vals.length;
      writer.writeRawByte((len >> 8) & 0xff); writer.writeRawByte(len & 0xff);
      writer.writeRawByte((tableClass << 4) | tableId);
      writer.writeRawBytes(new Uint8Array(bits));
      writer.writeRawBytes(new Uint8Array(vals));
    }

    writeDHT(0, 0, DC_LUM_BITS, DC_LUM_VALS);
    writeDHT(1, 0, AC_LUM_BITS, AC_LUM_VALS);
    if (!isGray) {
      writeDHT(0, 1, DC_CHR_BITS, DC_CHR_VALS);
      writeDHT(1, 1, AC_CHR_BITS, AC_CHR_VALS);
    }

    // 7. SOS (0xFFDA) Start of Scan
    writer.writeRawByte(0xff); writer.writeRawByte(0xda);
    const sosLen = 6 + numComps * 2;
    writer.writeRawByte((sosLen >> 8) & 0xff); writer.writeRawByte(sosLen & 0xff);
    writer.writeRawByte(numComps);
    if (isGray) {
      writer.writeRawByte(1); writer.writeRawByte(0x00);
    } else {
      writer.writeRawByte(1); writer.writeRawByte(0x00);
      writer.writeRawByte(2); writer.writeRawByte(0x11);
      writer.writeRawByte(3); writer.writeRawByte(0x11);
    }
    writer.writeRawByte(0);  // Ss = 0
    writer.writeRawByte(63); // Se = 63
    writer.writeRawByte(0);  // Ah/Al = 0

    // 8. Entropy Coded Scan Data
    const mcusX = Math.ceil(width / 8);
    const mcusY = Math.ceil(height / 8);

    const blockY = new Float64Array(64);
    const blockCb = isGray ? null : new Float64Array(64);
    const blockCr = isGray ? null : new Float64Array(64);

    const dctY = new Float64Array(64);
    const dctCb = isGray ? null : new Float64Array(64);
    const dctCr = isGray ? null : new Float64Array(64);

    const qBlock = new Int32Array(64);

    let prevDcY = 0;
    let prevDcCb = 0;
    let prevDcCr = 0;

    function encodeBlock(dct, quantTable, prevDc, dcBook, acBook) {
      for (let k = 0; k < 64; k++) {
        const naturalIdx = ZIGZAG[k];
        qBlock[k] = Math.round(dct[naturalIdx] / quantTable[naturalIdx]);
      }

      const dcVal = qBlock[0];
      const dcDiff = dcVal - prevDc;
      const { cat: dcCat, bits: dcBits } = getMagnitudeBits(dcDiff);
      const dcEntry = dcBook.get(dcCat);
      writer.writeBits(dcEntry.code, dcEntry.len);
      if (dcCat > 0) {
        writer.writeBits(dcBits, dcCat);
      }

      let zeroRun = 0;
      for (let k = 1; k < 64; k++) {
        const acVal = qBlock[k];
        if (acVal === 0) {
          zeroRun++;
        } else {
          while (zeroRun >= 16) {
            const zrlEntry = acBook.get(0xf0);
            writer.writeBits(zrlEntry.code, zrlEntry.len);
            zeroRun -= 16;
          }
          const { cat: acCat, bits: acBits } = getMagnitudeBits(acVal);
          const acSymbol = (zeroRun << 4) | acCat;
          const acEntry = acBook.get(acSymbol);
          writer.writeBits(acEntry.code, acEntry.len);
          writer.writeBits(acBits, acCat);
          zeroRun = 0;
        }
      }
      if (zeroRun > 0) {
        const eobEntry = acBook.get(0x00);
        writer.writeBits(eobEntry.code, eobEntry.len);
      }

      return dcVal;
    }

    for (let mcuY = 0; mcuY < mcusY; mcuY++) {
      for (let mcuX = 0; mcuX < mcusX; mcuX++) {
        const startX = mcuX * 8;
        const startY = mcuY * 8;

        for (let by = 0; by < 8; by++) {
          const py = Math.min(startY + by, height - 1);
          const rowOffset = py * width * channels;
          for (let bx = 0; bx < 8; bx++) {
            const px = Math.min(startX + bx, width - 1);
            const idx = rowOffset + px * channels;
            const bIdx = by * 8 + bx;

            if (isGray) {
              blockY[bIdx] = data[idx] - 128;
            } else {
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              blockY[bIdx] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
              blockCb[bIdx] = -0.168736 * r - 0.331264 * g + 0.5 * b;
              blockCr[bIdx] = 0.5 * r - 0.418688 * g - 0.081312 * b;
            }
          }
        }

        fdct8x8(blockY, dctY);
        prevDcY = encodeBlock(dctY, lumQ, prevDcY, DC_LUM_BOOK, AC_LUM_BOOK);

        if (!isGray) {
          fdct8x8(blockCb, dctCb);
          fdct8x8(blockCr, dctCr);
          prevDcCb = encodeBlock(dctCb, chrQ, prevDcCb, DC_CHR_BOOK, AC_CHR_BOOK);
          prevDcCr = encodeBlock(dctCr, chrQ, prevDcCr, DC_CHR_BOOK, AC_CHR_BOOK);
        }
      }
    }

    writer.flush();

    // 9. EOI (0xFFD9)
    writer.writeRawByte(0xff); writer.writeRawByte(0xd9);

    return writer.getUint8Array();
  }
}
