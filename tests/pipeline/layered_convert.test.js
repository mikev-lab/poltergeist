/**
 * @file layered_convert.test.js
 * @description End-to-end integration tests for layered format conversion and transparency flattening.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { convert, ExportFormat } from '../../src/pipeline/convert.js';
import { TransparencyFlattener } from '../../src/compositor/flattener/transparency_flattener.js';
import { PsdColorMode } from '../../src/ingestion/layered/psd/header.js';

/**
 * Builds a minimal valid PSD buffer for testing E2E pipeline.
 */
function buildTestPsd() {
  const width = 4;
  const height = 4;
  const parts = [];

  // Header (26 bytes)
  const header = Buffer.alloc(26);
  header.write('8BPS', 0, 'ascii');
  header.writeUInt16BE(1, 4); // Version 1
  header.writeUInt16BE(3, 12); // 3 channels (RGB)
  header.writeUInt32BE(height, 14);
  header.writeUInt32BE(width, 18);
  header.writeUInt16BE(8, 22); // 8-bit
  header.writeUInt16BE(PsdColorMode.RGB, 24);
  parts.push(header);

  // Color Mode Data
  const colorData = Buffer.alloc(4);
  parts.push(colorData);

  // Image Resources (empty 4-byte len)
  const imgRes = Buffer.alloc(4);
  parts.push(imgRes);

  // Layer & Mask section (empty 4-byte len)
  const layerMask = Buffer.alloc(4);
  parts.push(layerMask);

  // Composite Image (Raw, 2 bytes compression + 48 bytes RGB pixel data)
  const comp = Buffer.alloc(2 + width * height * 3);
  comp.writeUInt16BE(0, 0); // Raw
  comp.fill(180, 2); // fill gray
  parts.push(comp);

  return Buffer.concat(parts);
}

describe('Layered Conversion & Transparency Flattening E2E Workflows', () => {
  it('E2E: Ingest PSD -> Flatten Transparency -> Export Certified PDF/X-1a', () => {
    const psdBuffer = buildTestPsd();

    const pdfBuffer = convert(psdBuffer, {
      targetFormat: ExportFormat.PDF_X1A,
      downsample: false
    });

    assert.ok(pdfBuffer instanceof Uint8Array);
    assert.ok(pdfBuffer.length > 100);

    const pdfString = Buffer.from(pdfBuffer).toString('latin1');
    assert.ok(pdfString.includes('PDF/X-1a:2001'), 'Includes PDF/X-1a identifier');
    assert.ok(pdfString.includes('/DeviceCMYK'), 'Target is DeviceCMYK');

    // Preflight check: zero prohibited live transparency dictionaries
    const preflight = TransparencyFlattener.preflightCheck(pdfBuffer);
    assert.strictEqual(preflight.compliant, true, 'Zero live transparency in flattened PDF/X-1a');
    assert.strictEqual(preflight.violations.length, 0);
  });

  it('E2E: Ingest PSD -> Export PDF/X-4', () => {
    const psdBuffer = buildTestPsd();

    const pdfBuffer = convert(psdBuffer, {
      targetFormat: ExportFormat.PDF_X4,
      downsample: false
    });

    assert.ok(pdfBuffer instanceof Uint8Array);
    assert.ok(pdfBuffer.length > 100);

    const pdfString = Buffer.from(pdfBuffer).toString('latin1');
    assert.ok(pdfString.includes('PDF/X-4'), 'Includes PDF/X-4 identifier');
  });

  it('E2E: Ingest PSD -> Export Discrete Prepress Separation Plates (tiffsep)', () => {
    const psdBuffer = buildTestPsd();

    const plates = convert(psdBuffer, {
      targetFormat: ExportFormat.TIFFSEP,
      downsample: false
    });

    assert.ok(plates instanceof Map, 'Returns map of separation plates');
    const keys = Array.from(plates.keys());
    assert.ok(keys.some(k => k.includes('Cyan')), 'Cyan plate present');
    assert.ok(keys.some(k => k.includes('Magenta')), 'Magenta plate present');
    assert.ok(keys.some(k => k.includes('Yellow')), 'Yellow plate present');
    assert.ok(keys.some(k => k.includes('Black')), 'Black plate present');
    assert.ok(keys.some(k => k.endsWith('.tif')), 'Composite proof present');
  });
});
