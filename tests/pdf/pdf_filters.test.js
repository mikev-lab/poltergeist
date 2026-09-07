/**
 * @file pdf_filters.test.js
 * @description Unit tests for PDF stream filter decompressors: Flate, TIFF/PNG Predictors, ASCII85, ASCIIHex, RunLength.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { PdfFilterDecoder } from '../../src/ingestion/pdf/filters.js';

describe('PdfFilterDecoder: PDF Stream Filter Decompressors', () => {
  test('Golden Path: FlateDecode standard zlib stream', () => {
    const rawData = Buffer.from('Poltergeist Prepress Stream Content 2026', 'latin1');
    const compressed = zlib.deflateSync(rawData);

    const decoded = PdfFilterDecoder.decode(compressed, 'FlateDecode');
    assert.deepEqual(decoded, new Uint8Array(rawData));
  });

  test('Golden Path: FlateDecode with TIFF Predictor 2 (horizontal difference)', () => {
    // 2 rows of 4 columns, 1 byte per pixel: [10, 20, 30, 40], [50, 60, 70, 80]
    // After TIFF diff: [10, 10, 10, 10], [50, 10, 10, 10]
    const diffData = Buffer.from([
      10, 10, 10, 10,
      50, 10, 10, 10
    ]);
    const compressed = zlib.deflateSync(diffData);

    const decodeParms = new Map([
      ['Predictor', 2],
      ['Columns', 4],
      ['Colors', 1],
      ['BitsPerComponent', 8]
    ]);

    const decoded = PdfFilterDecoder.decode(compressed, 'FlateDecode', decodeParms);
    assert.deepEqual(decoded, new Uint8Array([
      10, 20, 30, 40,
      50, 60, 70, 80
    ]));
  });

  test('Golden Path: FlateDecode with PNG Predictor (Filters: None, Sub, Up, Average, Paeth)', () => {
    // 2 rows of 3 columns, 1 byte per pixel
    // Row 0: Filter 0 (None): [10, 20, 30] -> raw: [0, 10, 20, 30]
    // Row 1: Filter 1 (Sub): target [15, 30, 45] -> raw: [1, 15, 15, 15]
    const pngRaw = Buffer.from([
      0, 10, 20, 30,
      1, 15, 15, 15
    ]);
    const compressed = zlib.deflateSync(pngRaw);

    const decodeParms = new Map([
      ['Predictor', 12],
      ['Columns', 3],
      ['Colors', 1],
      ['BitsPerComponent', 8]
    ]);

    const decoded = PdfFilterDecoder.decode(compressed, 'FlateDecode', decodeParms);
    assert.deepEqual(decoded, new Uint8Array([
      10, 20, 30,
      15, 30, 45
    ]));
  });

  test('Golden Path: ASCIIHexDecode', () => {
    const hexInput = Buffer.from('48 65 6C 6C 6F >', 'latin1');
    const decoded = PdfFilterDecoder.decode(hexInput, 'ASCIIHexDecode');
    assert.equal(new TextDecoder('latin1').decode(decoded), 'Hello');

    // Odd nibble
    const oddHexInput = Buffer.from('61 62 6>', 'latin1');
    const oddDecoded = PdfFilterDecoder.decode(oddHexInput, 'ASCIIHexDecode');
    assert.equal(new TextDecoder('latin1').decode(oddDecoded), 'ab`');
  });

  test('Golden Path: ASCII85Decode', () => {
    // Encoded 'Hello World' in ASCII85 is: 87cURD]i,"Ebo7~>
    const a85Input = Buffer.from('<~87cURD]i,"Ebo7~>', 'latin1');
    const decoded = PdfFilterDecoder.decode(a85Input, 'ASCII85Decode');
    assert.equal(new TextDecoder('latin1').decode(decoded), 'Hello World');

    // Four zeros: 'z'
    const zInput = Buffer.from('<~z~>', 'latin1');
    const zDecoded = PdfFilterDecoder.decode(zInput, 'ASCII85Decode');
    assert.deepEqual(zDecoded, new Uint8Array([0, 0, 0, 0]));
  });

  test('Golden Path: RunLengthDecode', () => {
    // RLE format:
    // length byte 0..127: copy n + 1 bytes
    // length byte 129..255: repeat next byte 257 - n times
    // length byte 128: EOD
    const rleInput = Buffer.from([
      2, 0x41, 0x42, 0x43, // copy 3 bytes: 'ABC'
      257 - 4, 0x58,        // repeat 'X' 4 times: 'XXXX'
      128                   // EOD
    ]);

    const decoded = PdfFilterDecoder.decode(rleInput, 'RunLengthDecode');
    assert.equal(new TextDecoder('latin1').decode(decoded), 'ABCXXXX');
  });
});
