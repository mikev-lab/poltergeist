/**
 * @file camera_raw.test.js
 * @description Comprehensive unit and adversarial tests for Camera RAW and Digital Negative decoders.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { RawDecoder } from '../../src/ingestion/raw/raw_decoder.js';
import { ColorSpaceType } from '../../src/types/image.js';

test('Camera RAW Decoder: Multi-Format Signatures & Probing', async (t) => {
  await t.test('Sniffs Fujifilm RAF header signature', () => {
    const rafHeader = new Uint8Array(16);
    rafHeader.set([0x46, 0x55, 0x4A, 0x49, 0x46, 0x49, 0x4C, 0x4D]); // 'FUJIFILM'
    assert.equal(RawDecoder.probe(rafHeader), true);
  });

  await t.test('Sniffs Minolta MRW header signature', () => {
    const mrwHeader = new Uint8Array(16);
    mrwHeader.set([0x00, 0x4D, 0x52, 0x4D]); // \x00MRM
    assert.equal(RawDecoder.probe(mrwHeader), true);
  });

  await t.test('Sniffs Sigma X3F header signature', () => {
    const x3fHeader = new Uint8Array(16);
    x3fHeader.set([0x46, 0x4F, 0x56, 0x62]); // 'FOVb'
    assert.equal(RawDecoder.probe(x3fHeader), true);
  });

  await t.test('Sniffs Olympus ORF header signature', () => {
    const orfHeader = new Uint8Array(16);
    orfHeader.set([0x49, 0x49, 0x52, 0x4F]); // 'IIRO'
    assert.equal(RawDecoder.probe(orfHeader), true);
  });

  await t.test('Sniffs Canon CR2 header signature', () => {
    const cr2Header = new Uint8Array(16);
    cr2Header.set([0x49, 0x49, 0x2A, 0x00]); // TIFF 'II*\0'
    cr2Header[8] = 0x43; // 'C'
    cr2Header[9] = 0x52; // 'R'
    assert.equal(RawDecoder.probe(cr2Header), true);
  });

  await t.test('Sniffs Adobe DNG with DNGVersion tag (0xC612)', () => {
    // Construct minimal TIFF container with DNGVersion tag
    const buf = new Uint8Array(128);
    const view = new DataView(buf.buffer);
    buf[0] = 0x49; buf[1] = 0x49; buf[2] = 0x2A; buf[3] = 0x00; // 'II*\0'
    view.setUint32(4, 8, true); // First IFD offset = 8
    view.setUint16(8, 1, true); // 1 entry
    // Entry 0: tag 0xC612 (DNGVersion), type 1, count 4, value [1, 4, 0, 0]
    view.setUint16(10, 0xC612, true);
    view.setUint16(12, 1, true);
    view.setUint32(14, 4, true);
    view.setUint32(18, 0x01040000, true);

    assert.equal(RawDecoder.probe(buf), true);
  });

  await t.test('Rejects non-RAW buffer or standard TIFF without CFA tags', () => {
    // Normal TIFF with only ImageWidth (0x0100) tag
    const normalTiff = new Uint8Array(64);
    const view = new DataView(normalTiff.buffer);
    normalTiff[0] = 0x49; normalTiff[1] = 0x49; normalTiff[2] = 0x2A; normalTiff[3] = 0x00;
    view.setUint32(4, 8, true);
    view.setUint16(8, 1, true);
    view.setUint16(10, 0x0100, true); // ImageWidth
    view.setUint16(12, 4, true);
    view.setUint32(14, 1, true);
    view.setUint32(18, 100, true);

    assert.equal(RawDecoder.probe(normalTiff), false);
    assert.equal(RawDecoder.probe(new Uint8Array(5)), false);
  });
});

test('Camera RAW Decoder: DNG Ingestion & Calibration', async (t) => {
  await t.test('Golden Path: Decodes synthetic 4x4 DNG buffer into calibrated RasterImage', () => {
    const width = 4;
    const height = 4;
    const numSensels = width * height;
    const ifdOffset = 8;
    const numEntries = 5;
    const dataOffset = ifdOffset + 2 + numEntries * 12 + 4; // 8 + 2 + 60 + 4 = 74
    const totalSize = dataOffset + numSensels * 2;

    const buf = new Uint8Array(totalSize);
    const view = new DataView(buf.buffer);

    // TIFF Header
    buf[0] = 0x49; buf[1] = 0x49; buf[2] = 0x2A; buf[3] = 0x00;
    view.setUint32(4, ifdOffset, true);

    // IFD Entries
    view.setUint16(ifdOffset, numEntries, true);
    let e = ifdOffset + 2;

    // 1. ImageWidth
    view.setUint16(e, 0x0100, true); view.setUint16(e + 2, 3, true); view.setUint32(e + 4, 1, true); view.setUint16(e + 8, width, true); e += 12;
    // 2. ImageHeight
    view.setUint16(e, 0x0101, true); view.setUint16(e + 2, 3, true); view.setUint32(e + 4, 1, true); view.setUint16(e + 8, height, true); e += 12;
    // 3. DNGVersion (0xC612)
    view.setUint16(e, 0xC612, true); view.setUint16(e + 2, 1, true); view.setUint32(e + 4, 4, true); view.setUint32(e + 8, 0x01040000, true); e += 12;
    // 4. CFAPattern (0x828E: 0 = RGGB)
    view.setUint16(e, 0x828E, true); view.setUint16(e + 2, 3, true); view.setUint32(e + 4, 1, true); view.setUint16(e + 8, 0, true); e += 12;
    // 5. StripOffsets (0x0111)
    view.setUint16(e, 0x0111, true); view.setUint16(e + 2, 4, true); view.setUint32(e + 4, 1, true); view.setUint32(e + 8, dataOffset, true); e += 12;

    // Sensel data
    for (let i = 0; i < numSensels; i++) {
      view.setUint16(dataOffset + i * 2, 32768, true);
    }

    const raster = RawDecoder.decode(buf);
    assert.equal(raster.width, 4);
    assert.equal(raster.height, 4);
    assert.equal(raster.channels, 3);
    assert.equal(raster.colorSpace, ColorSpaceType.RGB);
  });

  await t.test('Adversarial: Throws error on corrupted/unsupported file', () => {
    const invalidBuf = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    assert.throws(() => RawDecoder.decode(invalidBuf), /Unsupported or invalid/);
  });
});
