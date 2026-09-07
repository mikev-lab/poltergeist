/**
 * @file xcf_decoder.test.js
 * @description Unit and adversarial tests for GIMP XCF format decoder.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XcfDecoder } from '../../src/ingestion/layered/xcf/xcf_decoder.js';

/**
 * Builds a synthetic valid GIMP XCF binary buffer for testing.
 */
function buildSyntheticXcf({
  width = 800,
  height = 600,
  dpi = 300,
  layers = []
} = {}) {
  const parts = [];

  // Header: 14 bytes ('gimp xcf v001\0')
  const header = Buffer.alloc(26);
  header.write('gimp xcf v001\0', 0, 'ascii');
  header.writeUInt32BE(width, 14);
  header.writeUInt32BE(height, 18);
  header.writeUInt32BE(0, 22); // 0 = RGB
  parts.push(header);

  // Canvas properties: PROP_RESOLUTION (18), PROP_END (0)
  const propRes = Buffer.alloc(16);
  propRes.writeUInt32BE(18, 0); // PROP_RESOLUTION
  propRes.writeUInt32BE(8, 4);  // length = 8
  propRes.writeFloatBE(dpi, 8); // xRes
  propRes.writeFloatBE(dpi, 12); // yRes
  parts.push(propRes);

  const propEnd = Buffer.alloc(8);
  propEnd.writeUInt32BE(0, 0); // PROP_END
  propEnd.writeUInt32BE(0, 4);
  parts.push(propEnd);

  // Layer directory offsets: one offset per layer, terminated by 0
  // First calculate where layer data will start
  const baseOffset = 26 + propRes.length + propEnd.length;
  const dirLength = (layers.length + 1) * 4;
  let curLayerOffset = baseOffset + dirLength;

  const dirBuf = Buffer.alloc(dirLength);
  const layerBufs = [];

  for (let i = 0; i < layers.length; i++) {
    dirBuf.writeUInt32BE(curLayerOffset, i * 4);
    const lyr = layers[i];

    // Layer record: width (4), height (4), type (4), name (uint32 len + string + \0)
    const name = lyr.name || `Layer ${i + 1}`;
    const nameLen = Buffer.byteLength(name, 'ascii') + 1;
    const namePadded = Buffer.alloc(4 + nameLen);
    namePadded.writeUInt32BE(nameLen, 0);
    namePadded.write(name, 4, 'ascii');

    // Layer properties: PROP_OPACITY (6), PROP_VISIBLE (7), PROP_OFFSETS (15), PROP_END (0)
    const lyrProps = Buffer.alloc(12 + 12 + 16 + 8);
    let pOff = 0;

    // PROP_OPACITY: 6, len 4, float 0..255
    lyrProps.writeUInt32BE(6, pOff); pOff += 4;
    lyrProps.writeUInt32BE(4, pOff); pOff += 4;
    lyrProps.writeFloatBE((lyr.opacity ?? 1.0) * 255.0, pOff); pOff += 4;

    // PROP_VISIBLE: 7, len 4, uint32 1
    lyrProps.writeUInt32BE(7, pOff); pOff += 4;
    lyrProps.writeUInt32BE(4, pOff); pOff += 4;
    lyrProps.writeUInt32BE(lyr.visible !== false ? 1 : 0, pOff); pOff += 4;

    // PROP_OFFSETS: 15, len 8, int32 x, int32 y
    lyrProps.writeUInt32BE(15, pOff); pOff += 4;
    lyrProps.writeUInt32BE(8, pOff); pOff += 4;
    lyrProps.writeInt32BE(lyr.left || 0, pOff); pOff += 4;
    lyrProps.writeInt32BE(lyr.top || 0, pOff); pOff += 4;

    // PROP_END
    lyrProps.writeUInt32BE(0, pOff); pOff += 4;
    lyrProps.writeUInt32BE(0, pOff); pOff += 4;

    const layerRecordHeader = Buffer.alloc(12);
    layerRecordHeader.writeUInt32BE(lyr.width || width, 0);
    layerRecordHeader.writeUInt32BE(lyr.height || height, 4);
    layerRecordHeader.writeUInt32BE(0, 8); // RGB

    const completeLayer = Buffer.concat([layerRecordHeader, namePadded, lyrProps]);
    layerBufs.push(completeLayer);
    curLayerOffset += completeLayer.length;
  }

  dirBuf.writeUInt32BE(0, layers.length * 4); // Directory termination
  parts.push(dirBuf);
  for (const b of layerBufs) parts.push(b);

  return Buffer.concat(parts);
}

describe('XcfDecoder: GIMP XCF Format Ingestion', () => {
  it('Golden Path: Decodes valid XCF buffer with resolution and multi-layer structure', () => {
    const xcfBuffer = buildSyntheticXcf({
      width: 1920,
      height: 1080,
      dpi: 300,
      layers: [
        { name: 'Background Layer', width: 1920, height: 1080, opacity: 1.0, visible: true },
        { name: 'Overlay Character', width: 400, height: 600, opacity: 0.8, left: 100, top: 200 }
      ]
    });

    const layered = XcfDecoder.decode(xcfBuffer);
    assert.strictEqual(layered.width, 1920);
    assert.strictEqual(layered.height, 1080);
    assert.strictEqual(layered.resolution.dpiX, 300);
    assert.strictEqual(layered.resolution.dpiY, 300);
    assert.strictEqual(layered.layers.length, 2);

    assert.strictEqual(layered.layers[0].name, 'Background Layer');
    assert.strictEqual(layered.layers[0].opacity, 1.0);

    assert.strictEqual(layered.layers[1].name, 'Overlay Character');
    assert.ok(Math.abs(layered.layers[1].opacity - 0.8) < 1e-3);
    assert.strictEqual(layered.layers[1].left, 100);
    assert.strictEqual(layered.layers[1].top, 200);
    assert.strictEqual(layered.layers[1].right, 500);
    assert.strictEqual(layered.layers[1].bottom, 800);
  });

  it('Adversarial: Rejects buffer with invalid magic signature', () => {
    const badBuf = Buffer.alloc(40);
    badBuf.write('not_gimp_xcf', 0, 'ascii');
    assert.throws(() => {
      XcfDecoder.decode(badBuf);
    }, /Invalid XCF magic/);
  });

  it('Adversarial: Rejects truncated buffer under 26 bytes', () => {
    assert.throws(() => {
      XcfDecoder.decode(new Uint8Array(15));
    }, /less than header size/);
  });
});
