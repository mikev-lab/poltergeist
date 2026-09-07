/**
 * @file psd_decoder.test.js
 * @description Comprehensive unit and integration tests for Adobe Photoshop PSD and PSB ingestion.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PsdDecoder } from '../../src/ingestion/layered/psd/psd_decoder.js';
import { PsdHeader, PsdColorMode } from '../../src/ingestion/layered/psd/header.js';
import { PsdPackBits } from '../../src/ingestion/layered/psd/rle.js';
import { PsdResources } from '../../src/ingestion/layered/psd/resources.js';
import { ColorSpaceType } from '../../src/types/image.js';
import { BlendMode } from '../../src/types/layer.js';

/**
 * Builds a synthetic valid multi-layer PSD buffer for testing.
 */
function buildSyntheticPsd({
  width = 2,
  height = 2,
  version = 1,
  colorMode = PsdColorMode.RGB,
  dpi = 300,
  layers = []
} = {}) {
  const parts = [];

  // 1. Header (26 bytes)
  const header = Buffer.alloc(26);
  header.write('8BPS', 0, 'ascii');
  header.writeUInt16BE(version, 4); // 1 = PSD, 2 = PSB
  // 6 reserved bytes (zeros)
  header.writeUInt16BE(3, 12); // 3 channels (RGB)
  header.writeUInt32BE(height, 14);
  header.writeUInt32BE(width, 18);
  header.writeUInt16BE(8, 22); // 8-bit depth
  header.writeUInt16BE(colorMode, 24);
  parts.push(header);

  // 2. Color Mode Data (empty: 4 bytes of 0 length)
  const colorData = Buffer.alloc(4);
  colorData.writeUInt32BE(0, 0);
  parts.push(colorData);

  // 3. Image Resources (ResolutionInfo 0x03ED)
  const resBlock = Buffer.alloc(28);
  resBlock.write('8BIM', 0, 'ascii');
  resBlock.writeUInt16BE(0x03ED, 4); // ResolutionInfo
  resBlock.writeUInt16BE(0, 6); // Empty Pascal string (padded to 2 bytes)
  resBlock.writeUInt32BE(16, 8); // Resource size = 16 bytes
  // Resolution info payload:
  // Horizontal DPI: 16.16 fixed point
  resBlock.writeUInt32BE(dpi * 65536, 12);
  resBlock.writeUInt16BE(1, 16); // 1 = pixels per inch
  resBlock.writeUInt16BE(1, 18);
  // Vertical DPI: 16.16 fixed point
  resBlock.writeUInt32BE(dpi * 65536, 20);
  resBlock.writeUInt16BE(1, 24);
  resBlock.writeUInt16BE(1, 26);

  const resSection = Buffer.alloc(4 + resBlock.length);
  resSection.writeUInt32BE(resBlock.length, 0);
  resBlock.copy(resSection, 4);
  parts.push(resSection);

  // 4. Layer and Mask Information Section
  if (layers.length > 0) {
    const layerRecordsBufs = [];
    const channelDataBufs = [];

    for (const lyr of layers) {
      // Channel info: 3 channels (0 = R, 1 = G, 2 = B)
      const chInfoBuf = Buffer.alloc(3 * (version === 1 ? 6 : 10));
      for (let ch = 0; ch < 3; ch++) {
        const off = ch * (version === 1 ? 6 : 10);
        chInfoBuf.writeInt16BE(ch, off);
        const dataLen = 2 + lyr.width * lyr.height; // Raw (comp 0) + raw pixels
        if (version === 1) {
          chInfoBuf.writeUInt32BE(dataLen, off + 2);
        } else {
          chInfoBuf.writeBigUInt64BE(BigInt(dataLen), off + 2);
        }

        // Channel raw data
        const chData = Buffer.alloc(dataLen);
        chData.writeUInt16BE(0, 0); // Compression 0 = Raw
        chData.fill(lyr.colors ? lyr.colors[ch] : 128, 2);
        channelDataBufs.push(chData);
      }

      // Extra data: layer name Pascal string
      const name = lyr.name || 'Layer';
      const nameLen = Buffer.byteLength(name, 'ascii');
      const pascalLen = 1 + nameLen;
      const paddedPascalLen = Math.ceil(pascalLen / 4) * 4;
      const extraData = Buffer.alloc(12 + paddedPascalLen);
      extraData.writeUInt32BE(0, 0); // Mask data len = 0
      extraData.writeUInt32BE(0, 4); // Blending ranges len = 0
      extraData.writeUInt8(nameLen, 8);
      extraData.write(name, 9, 'ascii');

      // Layer record
      const isPsb = version === 2;
      const coordSize = isPsb ? 32 : 16;
      const rec = Buffer.alloc(coordSize + 2 + chInfoBuf.length + 4 + 4 + 1 + 1 + 1 + 1 + 4 + extraData.length);
      let rOff = 0;
      if (isPsb) {
        rec.writeBigInt64BE(BigInt(lyr.top || 0), rOff); rOff += 8;
        rec.writeBigInt64BE(BigInt(lyr.left || 0), rOff); rOff += 8;
        rec.writeBigInt64BE(BigInt((lyr.top || 0) + lyr.height), rOff); rOff += 8;
        rec.writeBigInt64BE(BigInt((lyr.left || 0) + lyr.width), rOff); rOff += 8;
      } else {
        rec.writeInt32BE(lyr.top || 0, rOff); rOff += 4;
        rec.writeInt32BE(lyr.left || 0, rOff); rOff += 4;
        rec.writeInt32BE((lyr.top || 0) + lyr.height, rOff); rOff += 4;
        rec.writeInt32BE((lyr.left || 0) + lyr.width, rOff); rOff += 4;
      }

      rec.writeUInt16BE(3, rOff); rOff += 2; // 3 channels
      chInfoBuf.copy(rec, rOff); rOff += chInfoBuf.length;

      rec.write('8BIM', rOff, 'ascii'); rOff += 4;
      rec.write(lyr.blendKey || 'norm', rOff, 'ascii'); rOff += 4;
      rec.writeUInt8(Math.round((lyr.opacity ?? 1.0) * 255), rOff++);
      rec.writeUInt8(lyr.clipping ? 1 : 0, rOff++);
      rec.writeUInt8(0x08, rOff++); // Flags: visible (bit 3 is 0 = visible, bit 1 is 1)
      rec.writeUInt8(0, rOff++); // Filler

      rec.writeUInt32BE(extraData.length, rOff); rOff += 4;
      extraData.copy(rec, rOff);

      layerRecordsBufs.push(rec);
    }

    // Layer Info block
    const allRecs = Buffer.concat(layerRecordsBufs);
    const allChs = Buffer.concat(channelDataBufs);
    const layerInfoLen = 2 + allRecs.length + allChs.length;

    const layerInfo = Buffer.alloc(2 + (version === 1 ? 4 : 8) + layerInfoLen);
    let lOff = 0;
    if (version === 1) {
      layerInfo.writeUInt32BE(layerInfoLen, lOff); lOff += 4;
    } else {
      layerInfo.writeBigUInt64BE(BigInt(layerInfoLen), lOff); lOff += 8;
    }
    layerInfo.writeInt16BE(layers.length, lOff); lOff += 2;
    allRecs.copy(layerInfo, lOff); lOff += allRecs.length;
    allChs.copy(layerInfo, lOff);

    // Enclosing Layer & Mask section
    const layerMaskSection = Buffer.alloc((version === 1 ? 4 : 8) + layerInfo.length);
    if (version === 1) {
      layerMaskSection.writeUInt32BE(layerInfo.length, 0);
      layerInfo.copy(layerMaskSection, 4);
    } else {
      layerMaskSection.writeBigUInt64BE(BigInt(layerInfo.length), 0);
      layerInfo.copy(layerMaskSection, 8);
    }
    parts.push(layerMaskSection);
  } else {
    // Empty layer and mask section
    const emptyLm = Buffer.alloc(version === 1 ? 4 : 8);
    parts.push(emptyLm);
  }

  // 5. Composite Image Data (Raw, comp = 0)
  const compData = Buffer.alloc(2 + width * height * 3);
  compData.writeUInt16BE(0, 0); // Raw
  compData.fill(200, 2);
  parts.push(compData);

  return Buffer.concat(parts);
}

describe('PsdDecoder: Golden Paths, Multi-Layer & Edge Cases', () => {
  it('Decodes valid multi-layer PSD CS6 with 2 layers and 300 DPI resolution', () => {
    const psdBuffer = buildSyntheticPsd({
      width: 4,
      height: 4,
      dpi: 300,
      layers: [
        { name: 'Background Blue', width: 4, height: 4, colors: [0, 0, 255], opacity: 1.0 },
        { name: 'Foreground Red', width: 4, height: 4, colors: [255, 0, 0], opacity: 0.5, blendKey: 'mul ' }
      ]
    });

    const layered = PsdDecoder.decode(psdBuffer);
    assert.strictEqual(layered.width, 4);
    assert.strictEqual(layered.height, 4);
    assert.strictEqual(layered.resolution.dpiX, 300);
    assert.strictEqual(layered.resolution.dpiY, 300);
    assert.strictEqual(layered.layers.length, 2);

    assert.strictEqual(layered.layers[0].name, 'Background Blue');
    assert.strictEqual(layered.layers[0].opacity, 1.0);

    assert.strictEqual(layered.layers[1].name, 'Foreground Red');
    assert.ok(Math.abs(layered.layers[1].opacity - 0.5) < 0.01, 'Opacity ~0.5');
    assert.strictEqual(layered.layers[1].blendMode, BlendMode.MULTIPLY);
  });

  it('PSB Large Document: Decodes version 2 header and 64-bit section sizes', () => {
    const psbBuffer = buildSyntheticPsd({
      width: 10,
      height: 10,
      version: 2, // PSB
      layers: [
        { name: 'Layer 1', width: 10, height: 10, colors: [100, 150, 200] }
      ]
    });

    const layered = PsdDecoder.decode(psbBuffer);
    assert.strictEqual(layered.width, 10);
    assert.strictEqual(layered.height, 10);
    assert.strictEqual(layered.layers.length, 1);
  });

  it('PackBits RLE: Decompresses repeated and literal run sequences accurately', () => {
    // Encode literal [1, 2, 3] and repeat [4, 4, 4, 4]
    // Literal 3 bytes: len = 3 - 1 = 2 -> [2, 1, 2, 3]
    // Repeat 4 bytes of 4: len = 1 - 4 = -3 -> [-3, 4] = [253, 4]
    const rleData = new Uint8Array([2, 1, 2, 3, 253, 4]);
    const decompressed = PsdPackBits.decompress(rleData, 7);

    assert.deepStrictEqual(Array.from(decompressed), [1, 2, 3, 4, 4, 4, 4]);
  });

  it('Adversarial: Rejects buffer with invalid magic number', () => {
    const badBuf = Buffer.alloc(30);
    badBuf.write('XXXX', 0, 'ascii');
    assert.throws(() => {
      PsdDecoder.decode(badBuf);
    }, /Invalid PSD signature/);
  });

  it('Adversarial: Rejects truncated buffer under 26 bytes', () => {
    assert.throws(() => {
      PsdDecoder.decode(new Uint8Array(15));
    }, /PSD header truncated/);
  });
});
