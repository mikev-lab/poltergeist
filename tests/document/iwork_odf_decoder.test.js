/**
 * @file iwork_odf_decoder.test.js
 * @description Unit tests for Apple iWork and OpenDocument (ODF) layout decoders.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { IworkDecoder } from '../../src/ingestion/document/iwork/iwork_decoder.js';
import { OdfDecoder } from '../../src/ingestion/document/odf/odf_decoder.js';
import { PdfWriter } from '../../src/export/pdf/writer.js';
import { PdfDictionary, PdfName, PdfArray, PdfString, PdfStream } from '../../src/export/pdf/objects.js';

function createZipBuffer(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const rawData = typeof file.data === 'string' ? Buffer.from(file.data, 'utf8') : file.data;
    const nameBuf = Buffer.from(file.name, 'utf8');
    const method = file.method !== undefined ? file.method : 0;

    let compData = rawData;
    if (method === 8) {
      compData = zlib.deflateRawSync(rawData);
    }

    const localOffset = offset;
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compData.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compData);
    offset += localHeader.length + compData.length;

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compData.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
  }

  const centralDirStart = offset;
  const centralDirBuf = Buffer.concat(centralHeaders);
  const centralDirSize = centralDirBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, centralDirBuf, eocd]);
}

function createMiniPdf() {
  const writer = new PdfWriter('1.4');
  const pagesDict = new PdfDictionary();
  pagesDict.set('Type', new PdfName('Pages'));
  pagesDict.set('MediaBox', new PdfArray([0, 0, 612, 792]));
  const pagesRef = writer.addObject(pagesDict);

  const pageDict = new PdfDictionary();
  pageDict.set('Type', new PdfName('Page'));
  pageDict.set('Parent', pagesRef);
  const pageRef = writer.addObject(pageDict);

  pagesDict.set('Kids', new PdfArray([pageRef]));
  pagesDict.set('Count', 1);

  const catalogDict = new PdfDictionary();
  catalogDict.set('Type', new PdfName('Catalog'));
  catalogDict.set('Pages', pagesRef);
  writer.rootRef = writer.addObject(catalogDict);

  return writer.compile();
}

describe('IworkDecoder: Apple iWork Package Ingestion', () => {
  test('Golden Path: Decodes embedded vector QuickLook/Preview.pdf', () => {
    const previewPdf = createMiniPdf();

    const iworkZip = createZipBuffer([
      { name: 'Index/Document.iwa', data: 'protobuf-data', method: 0 },
      { name: 'QuickLook/Preview.pdf', data: previewPdf, method: 0 }
    ]);

    assert.equal(IworkDecoder.probe(iworkZip), true);

    const doc = IworkDecoder.decode(iworkZip);
    assert.equal(doc.pages.length, 1);
    assert.equal(doc.pages[0].widthPts, 612);
    assert.equal(doc.pages[0].heightPts, 792);
  });

  test('Golden Path: Falls back to Keynote slide format when no PDF preview', () => {
    const keynoteZip = createZipBuffer([
      { name: 'Index/Document.iwa', data: 'protobuf', method: 0 },
      { name: 'Index/Slide-1.iwa', data: 'slide-data', method: 0 }
    ]);

    const doc = IworkDecoder.decode(keynoteZip);
    assert.equal(doc.pages.length, 1);
    // Keynote standard slide 1024 x 768
    assert.equal(doc.pages[0].widthPts, 1024);
    assert.equal(doc.pages[0].heightPts, 768);
  });
});

describe('OdfDecoder: OpenDocument Format Ingestion', () => {
  test('Golden Path: Decodes page dimensions and margins from styles.xml in inches and mm', () => {
    const stylesXml = `
      <style:page-layout-properties 
        fo:page-width="8.5in" 
        fo:page-height="11in" 
        fo:margin-top="0.5in" 
        fo:margin-bottom="0.5in" 
        fo:margin-left="0.75in" 
        fo:margin-right="0.75in" 
      />
    `;

    const contentXml = `
      <text:p>First page</text:p>
      <text:soft-page-break/>
      <text:p>Second page</text:p>
    `;

    const odfZip = createZipBuffer([
      { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', method: 0 },
      { name: 'styles.xml', data: stylesXml, method: 0 },
      { name: 'content.xml', data: contentXml, method: 0 }
    ]);

    assert.equal(OdfDecoder.probe(odfZip), true);

    const doc = OdfDecoder.decode(odfZip);
    assert.equal(doc.pages.length, 2);

    const p1 = doc.pages[0];
    assert.equal(p1.widthPts, 612); // 8.5 * 72
    assert.equal(p1.heightPts, 792); // 11 * 72

    // Margins: left=0.75*72=54, right=54, top=0.5*72=36, bottom=36
    assert.deepEqual(p1.pageBox.trimBox, [54, 36, 612 - 54, 792 - 36]);
  });

  test('Golden Path: Decodes presentation slides from draw:page elements', () => {
    const contentXml = `
      <office:body>
        <office:presentation>
          <draw:page draw:name="Slide 1"/>
          <draw:page draw:name="Slide 2"/>
          <draw:page draw:name="Slide 3"/>
        </office:presentation>
      </office:body>
    `;

    const odfPresZip = createZipBuffer([
      { name: 'mimetype', data: 'application/vnd.oasis.opendocument.presentation', method: 0 },
      { name: 'content.xml', data: contentXml, method: 0 }
    ]);

    const doc = OdfDecoder.decode(odfPresZip);
    assert.equal(doc.pages.length, 3);
  });
});
