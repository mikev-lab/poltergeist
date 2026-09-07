/**
 * @file filters.js
 * @description Pure native stream filter decompressors for PDF streams (/FlateDecode, /ASCII85, etc.).
 * Zero-dependency, memory-safe.
 */

import zlib from 'node:zlib';

export class PdfFilterDecoder {
  /**
   * Decompresses a PDF stream buffer using specified filter(s) and decode parameters.
   * 
   * @param {Uint8Array} streamBytes
   * @param {string|string[]} filter Filter name or array of filter names
   * @param {Map<string, any>|null} [decodeParms]
   * @returns {Uint8Array}
   */
  static decode(streamBytes, filter, decodeParms = null) {
    if (!filter) return streamBytes;

    const filters = Array.isArray(filter) ? filter : [filter];
    let data = streamBytes;

    for (const f of filters) {
      if (f === 'FlateDecode' || f === 'Fl') {
        data = this.decodeFlate(data, decodeParms);
      } else if (f === 'ASCII85Decode' || f === 'A85') {
        data = this.decodeAscii85(data);
      } else if (f === 'ASCIIHexDecode' || f === 'AHx') {
        data = this.decodeAsciiHex(data);
      } else if (f === 'RunLengthDecode' || f === 'RL') {
        data = this.decodeRunLength(data);
      } else if (f === 'DCTDecode' || f === 'DCT') {
        // JPEG stream is preserved or decoded via JpegDecoder if needed
      } else {
        throw new Error(`Unsupported PDF stream filter: ${f}`);
      }
    }

    return data;
  }

  /**
   * Decompresses Flate (Deflate/zlib) streams with optional PNG or TIFF predictors.
   * @param {Uint8Array} bytes
   * @param {Map<string, any>|null} [parms]
   * @returns {Uint8Array}
   */
  static decodeFlate(bytes, parms = null) {
    let decompressed;
    try {
      decompressed = zlib.inflateSync(bytes);
    } catch {
      // Fallback: try inflateRaw
      decompressed = zlib.inflateRawSync(bytes);
    }
    const raw = new Uint8Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);

    if (!parms || !(parms instanceof Map)) return raw;

    const predictor = parms.get('Predictor') || 1;
    if (predictor === 1) return raw; // No predictor

    const columns = parms.get('Columns') || 1;
    const colors = parms.get('Colors') || 1;
    const bitsPerComponent = parms.get('BitsPerComponent') || 8;
    const bytesPerPixel = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));

    if (predictor === 2) { // TIFF Predictor 2 (horizontal difference)
      const rowStride = columns * bytesPerPixel;
      const numRows = Math.floor(raw.length / rowStride);
      const out = new Uint8Array(raw);

      for (let r = 0; r < numRows; r++) {
        const rowStart = r * rowStride;
        for (let c = bytesPerPixel; c < rowStride; c++) {
          out[rowStart + c] = (out[rowStart + c] + out[rowStart + c - bytesPerPixel]) & 0xff;
        }
      }
      return out;
    }

    if (predictor >= 10 && predictor <= 15) { // PNG Predictors
      const rowBytes = columns * bytesPerPixel;
      const stride = rowBytes + 1; // 1 tag byte per row
      const numRows = Math.floor(raw.length / stride);
      const out = new Uint8Array(numRows * rowBytes);

      for (let r = 0; r < numRows; r++) {
        const inRow = r * stride;
        const outRow = r * rowBytes;
        const filterType = raw[inRow];

        for (let c = 0; c < rowBytes; c++) {
          const rawByte = raw[inRow + 1 + c];
          const left = c >= bytesPerPixel ? out[outRow + c - bytesPerPixel] : 0;
          const up = r > 0 ? out[(r - 1) * rowBytes + c] : 0;
          const upLeft = (r > 0 && c >= bytesPerPixel) ? out[(r - 1) * rowBytes + c - bytesPerPixel] : 0;

          let val = 0;
          if (filterType === 0) { // None
            val = rawByte;
          } else if (filterType === 1) { // Sub
            val = (rawByte + left) & 0xff;
          } else if (filterType === 2) { // Up
            val = (rawByte + up) & 0xff;
          } else if (filterType === 3) { // Average
            val = (rawByte + Math.floor((left + up) / 2)) & 0xff;
          } else if (filterType === 4) { // Paeth
            const p = left + up - upLeft;
            const pa = Math.abs(p - left);
            const pb = Math.abs(p - up);
            const pc = Math.abs(p - upLeft);
            let pr = left;
            if (pb < pa && pb <= pc) pr = up;
            else if (pc < pa && pc < pb) pr = upLeft;
            val = (rawByte + pr) & 0xff;
          } else {
            val = rawByte;
          }

          out[outRow + c] = val;
        }
      }

      return out;
    }

    return raw;
  }

  /**
   * Decodes Adobe Base-85 (ASCII85) stream: <~...~>
   * @param {Uint8Array} bytes
   * @returns {Uint8Array}
   */
  static decodeAscii85(bytes) {
    let str = new TextDecoder('latin1').decode(bytes);
    const start = str.indexOf('<~');
    if (start !== -1) str = str.substring(start + 2);
    const end = str.indexOf('~>');
    if (end !== -1) str = str.substring(0, end);

    // Strip whitespace
    str = str.replace(/\s+/g, '');

    const out = [];
    let tuple = 0;
    let count = 0;

    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c === 0x7a) { // 'z' represents 4 zeros
        if (count !== 0) throw new Error('ASCII85: "z" inside group.');
        out.push(0, 0, 0, 0);
        continue;
      }

      if (c < 33 || c > 117) continue;

      tuple = tuple * 85 + (c - 33);
      count++;

      if (count === 5) {
        out.push(
          (tuple >>> 24) & 0xff,
          (tuple >>> 16) & 0xff,
          (tuple >>> 8) & 0xff,
          tuple & 0xff
        );
        tuple = 0;
        count = 0;
      }
    }

    if (count > 0) {
      const padding = 5 - count;
      for (let i = 0; i < padding; i++) {
        tuple = tuple * 85 + 84;
      }
      for (let i = 0; i < count - 1; i++) {
        out.push((tuple >>> (24 - i * 8)) & 0xff);
      }
    }

    return new Uint8Array(out);
  }

  /**
   * Decodes hexadecimal stream (ASCIIHexDecode).
   * @param {Uint8Array} bytes
   * @returns {Uint8Array}
   */
  static decodeAsciiHex(bytes) {
    let str = new TextDecoder('latin1').decode(bytes);
    const end = str.indexOf('>');
    if (end !== -1) str = str.substring(0, end);
    str = str.replace(/\s+/g, '');
    if (str.length % 2 !== 0) str += '0';

    const out = new Uint8Array(str.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(str.substr(i * 2, 2), 16) || 0;
    }
    return out;
  }

  /**
   * Decodes PackBits run length streams (RunLengthDecode).
   * @param {Uint8Array} bytes
   * @returns {Uint8Array}
   */
  static decodeRunLength(bytes) {
    const out = [];
    let i = 0;
    const len = bytes.length;

    while (i < len) {
      const n = (bytes[i++] << 24) >> 24; // signed int8
      if (n === -128) break; // 128 is EOD

      if (n >= 0 && n <= 127) {
        const count = n + 1;
        for (let k = 0; k < count && i < len; k++) {
          out.push(bytes[i++]);
        }
      } else if (n >= -127 && n <= -1) {
        const count = -n + 1;
        if (i < len) {
          const val = bytes[i++];
          for (let k = 0; k < count; k++) {
            out.push(val);
          }
        }
      }
    }

    return new Uint8Array(out);
  }
}
