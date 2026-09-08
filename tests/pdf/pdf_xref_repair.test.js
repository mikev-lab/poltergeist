/**
 * @file pdf_xref_repair.test.js
 * @description Unit tests for PDF xref parser, self-healing xref repair engine, and page tree traverser.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { PdfXrefParser } from '../../src/ingestion/pdf/xref.js';
import { PdfRepair } from '../../src/ingestion/pdf/repair.js';
import { PdfDecoder } from '../../src/ingestion/pdf/pdf_decoder.js';
import { PageTreeTraverser } from '../../src/ingestion/pdf/page_tree.js';
import { PdfRef } from '../../src/ingestion/pdf/parser.js';
import { PdfWriter } from '../../src/export/pdf/writer.js';
import { PdfDictionary, PdfName, PdfArray, PdfString, PdfStream } from '../../src/export/pdf/objects.js';

/**
 * Creates a minimal valid 2-page PDF in memory for testing.
 * @returns {Uint8Array}
 */
function createMinimalPdf() {
  const writer = new PdfWriter('1.4');

  // Page 1 Content
  const p1Content = writer.addObject(new PdfStream(new PdfDictionary(), Buffer.from('q Q\n', 'latin1'), false));
  // Page 2 Content
  const p2Content = writer.addObject(new PdfStream(new PdfDictionary(), Buffer.from('q Q\n', 'latin1'), false));

  // Pages Dict (Parent with inherited MediaBox)
  const pagesDict = new PdfDictionary();
  pagesDict.set('Type', new PdfName('Pages'));
  pagesDict.set('MediaBox', new PdfArray([0, 0, 612, 792]));
  const pagesRef = writer.addObject(pagesDict);

  // Page 1
  const page1Dict = new PdfDictionary();
  page1Dict.set('Type', new PdfName('Page'));
  page1Dict.set('Parent', pagesRef);
  page1Dict.set('Contents', p1Content);
  const p1Ref = writer.addObject(page1Dict);

  // Page 2 (Overriding MediaBox to Landscape)
  const page2Dict = new PdfDictionary();
  page2Dict.set('Type', new PdfName('Page'));
  page2Dict.set('Parent', pagesRef);
  page2Dict.set('MediaBox', new PdfArray([0, 0, 792, 612]));
  page2Dict.set('Contents', p2Content);
  const p2Ref = writer.addObject(page2Dict);

  pagesDict.set('Kids', new PdfArray([p1Ref, p2Ref]));
  pagesDict.set('Count', 2);

  // Catalog
  const catalogDict = new PdfDictionary();
  catalogDict.set('Type', new PdfName('Catalog'));
  catalogDict.set('Pages', pagesRef);
  writer.rootRef = writer.addObject(catalogDict);

  // Info
  const infoDict = new PdfDictionary();
  infoDict.set('Title', new PdfString('Test Multi-Page PDF'));
  infoDict.set('Creator', new PdfString('Poltergeist Engine'));
  writer.infoRef = writer.addObject(infoDict);

  return writer.compile();
}

describe('PdfXrefParser & Self-Healing PdfRepair', () => {
  test('Golden Path: Parses intact xref table and trailer', () => {
    const pdfBytes = createMinimalPdf();
    const parser = new PdfXrefParser(pdfBytes);
    const xref = parser.parse();

    assert.ok(xref.trailer.has('Root'));
    assert.ok(xref.trailer.has('Size'));
    assert.ok(xref.offsets.size >= 5);

    const traverser = new PageTreeTraverser(pdfBytes, xref);
    const pages = traverser.traversePages();

    assert.equal(pages.length, 2);
    // Page 1 inherits MediaBox [0, 0, 612, 792] from parent /Pages
    assert.equal(pages[0].widthPts, 612);
    assert.equal(pages[0].heightPts, 792);

    // Page 2 overrides MediaBox to [0, 0, 792, 612]
    assert.equal(pages[1].widthPts, 792);
    assert.equal(pages[1].heightPts, 612);
  });

  test('Self-Healing: Reconstructs corrupted xref table and truncated startxref', () => {
    const validPdf = createMinimalPdf();

    // Sever the PDF by completely truncating the xref table and trailer at the end
    const text = new TextDecoder('latin1').decode(validPdf);
    const xrefPos = text.lastIndexOf('xref\n');
    assert.ok(xrefPos > 0);

    // Corrupted buffer: everything from 'xref\n' onwards replaced by garbage
    const severedPdf = Buffer.from(validPdf.subarray(0, xrefPos));

    // PdfXrefParser should fail because startxref is missing
    const parser = new PdfXrefParser(severedPdf);
    assert.throws(() => {
      parser.parse();
    }, /missing startxref marker/);

    // PdfRepair.repair should self-heal and recover all objects!
    const repairedXref = PdfRepair.repair(severedPdf);
    assert.ok(repairedXref.trailer.has('Root'));
    assert.ok(repairedXref.offsets.size >= 5);

    // Traversing repaired PDF recovers both pages
    const traverser = new PageTreeTraverser(severedPdf, repairedXref);
    const pages = traverser.traversePages();
    assert.equal(pages.length, 2);
    assert.equal(pages[0].widthPts, 612);
    assert.equal(pages[1].widthPts, 792);
  });

  test('PdfDecoder.decode: End-to-End ingestion with self-healing fallback', () => {
    const validPdf = createMinimalPdf();

    // Ingest intact PDF
    const doc1 = PdfDecoder.decode(validPdf);
    assert.equal(doc1.pages.length, 2);
    assert.equal(doc1.title, 'Test Multi-Page PDF');

    // Ingest damaged PDF without xref
    const text = new TextDecoder('latin1').decode(validPdf);
    const xrefPos = text.lastIndexOf('xref\n');
    const damagedPdf = Buffer.from(validPdf.subarray(0, xrefPos));

    const doc2 = PdfDecoder.decode(damagedPdf);
    assert.equal(doc2.pages.length, 2);
    assert.equal(doc2.pages[0].widthPts, 612);
    assert.equal(doc2.pages[1].widthPts, 792);
  });

  test('PDF 1.5+: Parses compressed XRef stream (/Type /XRef) and Object Streams (/Type /ObjStm)', () => {
    const header = Buffer.from('%PDF-1.5\n');
    const obj1Offset = header.length;
    const obj1 = Buffer.from('1 0 obj\n<</Type/ObjStm/N 1/First 4/Length 10>>\nstream\n2 0 12345\nendstream\nendobj\n');
    const obj3Offset = obj1Offset + obj1.length;

    // Type 1: uncompressed, Type 2: ObjStm
    // Table: obj 0 (free), obj 1 (offset obj1Offset), obj 2 (in ObjStm 1, index 0)
    // /W [1 2 1] -> entry size = 4 bytes
    const entries = Buffer.from([
      0, 0, 0, 0,
      1, Math.floor(obj1Offset / 256), obj1Offset % 256, 0,
      2, 0, 1, 0
    ]);
    const zlibStream = zlib.deflateSync(entries);
    const obj3Head = Buffer.from('3 0 obj\n<</Type/XRef/Size 3/W [1 2 1]/Filter/FlateDecode/Root 2 0 R/Length ' + zlibStream.length + '>>\nstream\n');
    const obj3Tail = Buffer.from('\nendstream\nendobj\nstartxref\n' + obj3Offset + '\n%%EOF\n');

    const xrefStreamPdf = Buffer.concat([header, obj1, obj3Head, zlibStream, obj3Tail]);

    const parser = new PdfXrefParser(xrefStreamPdf);
    const xref = parser.parse();

    // Verify xref table properties
    assert.equal(xref.offsets.get(1), obj1Offset);
    assert.deepEqual(xref.compressedObjects.get(2), { streamObjNum: 1, index: 0 });
    assert.ok(xref.trailer.has('Root'));

    // Verify PageTreeTraverser lazy resolution of compressed object from Object Stream
    const traverser = new PageTreeTraverser(xrefStreamPdf, xref);
    const resolved = traverser.resolve(new PdfRef(2, 0));
    assert.equal(resolved, 12345);
    assert.equal(traverser.objectCache.get(2), 12345);
  });
});

