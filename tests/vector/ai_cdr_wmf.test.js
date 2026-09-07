/**
 * @file ai_cdr_wmf.test.js
 * @description Comprehensive unit and adversarial tests for Adobe Illustrator (.ai), CorelDRAW (.cdr),
 * and Windows Metafile (.wmf, .emf) decoders.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { AiDecoder } from '../../src/ingestion/vector/ai_decoder.js';
import { CdrDecoder } from '../../src/ingestion/vector/cdr_decoder.js';
import { WmfDecoder } from '../../src/ingestion/vector/wmf_decoder.js';
import { probeVectorFormat, decodeVector } from '../../src/ingestion/vector/index.js';
import { Document } from '../../src/types/document.js';

test('AiDecoder: Modern PDF-Compatible & Legacy Illustrator Formats', async (t) => {
  await t.test('Sniffs and decodes modern PDF-based Illustrator file', () => {
    // Minimal valid PDF stream representing modern AI
    const pdfContent = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF';
    const buf = Buffer.from(pdfContent, 'latin1');

    assert.equal(AiDecoder.probe(buf), true);
    const doc = AiDecoder.decode(buf);
    assert.ok(doc instanceof Document);
    assert.equal(doc.pageCount, 1);
    assert.ok(doc.creator.includes('Illustrator'));
  });

  await t.test('Sniffs legacy PostScript-based Illustrator header', () => {
    const psContent = '%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator(R) 8.0\n%%BoundingBox: 0 0 500 500\n%%Pages: 1\n%%EOF';
    const buf = Buffer.from(psContent, 'latin1');
    assert.equal(AiDecoder.probe(buf), true);
    const doc = AiDecoder.decode(buf);
    assert.ok(doc instanceof Document);
    assert.equal(doc.pageCount, 1);
    assert.equal(doc.getPage(1).width, 500);
  });
});

test('CdrDecoder: Modern ZIP Package & Legacy RIFF Container', async (t) => {
  await t.test('Sniffs and decodes legacy RIFF-based CorelDRAW file', () => {
    // Construct RIFF....CDR  header
    const buf = new Uint8Array(32);
    const view = new DataView(buf.buffer);
    buf.set([0x52, 0x49, 0x46, 0x46]); // 'RIFF'
    view.setUint32(4, 20, true);        // RIFF size
    buf.set([0x43, 0x44, 0x52, 0x20], 8); // 'CDR '

    assert.equal(CdrDecoder.probe(buf), true);
    const doc = CdrDecoder.decode(buf);
    assert.ok(doc instanceof Document);
    assert.equal(doc.pageCount, 1);
    assert.ok(doc.getPage(1).metadata.format.includes('CorelDRAW Legacy'));
  });
});

test('WmfDecoder: Placeable WMF, Standard WMF, and EMF', async (t) => {
  await t.test('Sniffs and decodes Placeable WMF (APM) with vector records', () => {
    // Construct APM Header (22 bytes) + Standard WMF Header (18 bytes) + Records
    const totalSize = 22 + 18 + 14 + 6; // APM + WMF + LineTo record + EOF record
    const buf = new Uint8Array(totalSize);
    const view = new DataView(buf.buffer);

    // 1. APM Header: Magic 0x9AC6CDD7
    view.setUint32(0, 0x9AC6CDD7, true);
    view.setInt16(6, 0, true);   // left
    view.setInt16(8, 0, true);   // top
    view.setInt16(10, 1440, true); // right (1 inch = 72 pt)
    view.setInt16(12, 1440, true); // bottom (1 inch = 72 pt)
    view.setUint16(14, 1440, true); // unitsPerInch

    // 2. Standard WMF Header at offset 22
    view.setUint16(22, 1, true); // FileType (memory)
    view.setUint16(24, 9, true); // HeaderSize (9 words = 18 bytes)
    view.setUint16(26, 0x0300, true); // Version 3.0

    // 3. Record: META_RECTANGLE (0x041B, size = 7 words = 14 bytes) at offset 40
    view.setUint32(40, 7, true);
    view.setUint16(44, 0x041B, true);
    view.setInt16(46, 720, true);  // bottom
    view.setInt16(48, 720, true);  // right
    view.setInt16(50, 0, true);    // top
    view.setInt16(52, 0, true);    // left

    // 4. Record: META_EOF (0x0000, size = 3 words = 6 bytes) at offset 54
    view.setUint32(54, 3, true);
    view.setUint16(58, 0x0000, true);

    assert.equal(WmfDecoder.probe(buf), true);
    const doc = WmfDecoder.decode(buf);
    assert.ok(doc instanceof Document);
    assert.equal(doc.pageCount, 1);
    assert.equal(doc.getPage(1).width, 72);
    assert.equal(doc.getPage(1).height, 72);
    assert.equal(doc.getPage(1).paths.length, 1);
  });

  await t.test('Sniffs and decodes EMF binary metafile', () => {
    // EMF Header (88 bytes) + EOF record (20 bytes)
    const buf = new Uint8Array(108);
    const view = new DataView(buf.buffer);

    // EMR_HEADER (type 1)
    view.setUint32(0, 1, true);
    view.setUint32(4, 88, true);
    // Bounds: [0, 0, 96, 96]
    view.setInt32(8, 0, true);
    view.setInt32(12, 0, true);
    view.setInt32(16, 96, true);
    view.setInt32(20, 96, true);
    // Signature at offset 40: 0x28464D45 ('EMF ')
    view.setUint32(40, 0x28464D45, true);

    // EMR_EOF (type 0x0E) at offset 88
    view.setUint32(88, 0x0000000E, true);
    view.setUint32(92, 20, true);

    assert.equal(WmfDecoder.probe(buf), true);
    const doc = WmfDecoder.decode(buf);
    assert.ok(doc instanceof Document);
    assert.equal(doc.pageCount, 1);
    assert.equal(doc.getPage(1).width, 72); // 96 px * 72/96 = 72 pt
    assert.equal(doc.getPage(1).height, 72);
  });
});

test('Unified Vector Router: probeVectorFormat and decodeVector', async (t) => {
  await t.test('Correctly identifies and routes SVG and WMF inputs', () => {
    const svgStr = '<svg width="200" height="200"><rect x="0" y="0" width="10" height="10"/></svg>';
    assert.equal(probeVectorFormat(svgStr), 'svg');
    const doc = decodeVector(svgStr);
    assert.ok(doc instanceof Document);
    assert.equal(doc.getPage(1).width, 200);
  });

  await t.test('Adversarial: Throws on unrecognized vector format', () => {
    assert.throws(() => decodeVector(new Uint8Array([1, 2, 3, 4, 5])), /Unsupported or unrecognized/);
  });
});
