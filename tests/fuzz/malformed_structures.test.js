/**
 * @file malformed_structures.test.js
 * @description Adversarial tests asserting robust handling and self-healing recovery on
 * damaged PDF xref tables, corrupted SQLite databases, malformed vector paths, and invalid CAD entities.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PdfDecoder } from '../../src/ingestion/pdf/pdf_decoder.js';
import { PdfRepair } from '../../src/ingestion/pdf/repair.js';
import { SvgDecoder } from '../../src/ingestion/vector/svg_decoder.js';
import { DxfDecoder } from '../../src/ingestion/cad/dxf_decoder.js';
import { ClipDecoder } from '../../src/ingestion/layered/clip/clip_decoder.js';
import { createCorruptedPdfXref } from '../fixtures/fuzz/generator.js';
import { Document } from '../../src/types/document.js';

test('Adversarial & Self-Healing: Malformed Internal Structures', async (t) => {
  await t.test('PDF Self-Healing: Recovers from corrupted / non-numeric xref table', () => {
    const damagedPdf = createCorruptedPdfXref();
    const doc = PdfDecoder.decode(damagedPdf);
    assert.ok(doc instanceof Document);
    assert.equal(doc.pageCount, 1);
    assert.equal(doc.getPage(1).width, 612);
  });

  await t.test('ClipDecoder: Safely rejects corrupted SQLite header page with invalid page size', () => {
    const corruptClip = Buffer.alloc(100);
    corruptClip.write('SQLite format 3\0', 0, 'latin1');
    // Set page size to 0 (invalid)
    corruptClip.writeUInt16BE(0, 16);
    assert.throws(() => ClipDecoder.decode(corruptClip), /(Invalid SQLite page size|truncated|too small)/i);
  });

  await t.test('SvgDecoder: Gracefully skips corrupted path tokens and extreme exponents without crashing', () => {
    const malformedPathData = 'M 0 0 L 1e999 1e-999 C NaN Infinity -Infinity 0 10 10 Z ??? INVALID_TOKENS !!!';
    const path = SvgDecoder.parsePathData(malformedPathData);
    assert.ok(path.commands.length >= 1);

    const svgWithJunk = '<svg viewBox="0 0 100 100"><path d="INVALID_GARBAGE"/><rect width="-10" height="0"/></svg>';
    const doc = SvgDecoder.decode(svgWithJunk);
    assert.ok(doc instanceof Document);
    assert.equal(doc.pageCount, 1);
  });

  await t.test('DxfDecoder: Safely terminates on unexpected EOF without infinite loop', () => {
    const truncatedDxf = '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n100'; // abruptly cut mid-entity
    const doc = DxfDecoder.decode(truncatedDxf);
    assert.ok(doc instanceof Document);
    assert.equal(doc.pageCount, 1);
  });
});
