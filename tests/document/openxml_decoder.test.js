/**
 * @file openxml_decoder.test.js
 * @description Unit tests for Microsoft OpenXML decoders: Word (.docx), Excel (.xlsx), and PowerPoint (.pptx).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { WordDecoder } from '../../src/ingestion/document/openxml/word_decoder.js';
import { ExcelDecoder } from '../../src/ingestion/document/openxml/excel_decoder.js';
import { PptDecoder } from '../../src/ingestion/document/openxml/ppt_decoder.js';

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

describe('OpenXML Decoders: Word, Excel, PowerPoint', () => {
  test('WordDecoder: Extracts page dimensions, margins, and page breaks', () => {
    // 12240 x 15840 dxa = 612 x 792 pt (US Letter)
    // 1440 dxa = 72 pt (1 inch margin)
    const docXml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Page 1 Content</w:t></w:r></w:p>
          <w:p><w:r><w:br w:type="page"/></w:r></w:p>
          <w:p><w:r><w:t>Page 2 Content</w:t></w:r></w:p>
          <w:sectPr>
            <w:pgSz w:w="12240" w:h="15840"/>
            <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
          </w:sectPr>
        </w:body>
      </w:document>
    `;

    const wordZip = createZipBuffer([
      { name: '[Content_Types].xml', data: '<Types/>', method: 0 },
      { name: 'word/document.xml', data: docXml, method: 8 }
    ]);

    assert.equal(WordDecoder.probe(wordZip), true);

    const doc = WordDecoder.decode(wordZip);
    assert.equal(doc.pages.length, 2);

    const p1 = doc.pages[0];
    assert.equal(p1.widthPts, 612);
    assert.equal(p1.heightPts, 792);

    // Margins: 72 pt on all sides
    assert.deepEqual(p1.pageBox.trimBox, [72, 72, 612 - 72, 792 - 72]);

    const p2 = doc.pages[1];
    assert.equal(p2.widthPts, 612);
    assert.equal(p2.heightPts, 792);
  });

  test('ExcelDecoder: Extracts multiple worksheet pages', () => {
    const sheet1Xml = `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <pageSetup orientation="portrait" paperSize="1"/>
      </worksheet>
    `;
    const sheet2Xml = `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <pageSetup orientation="landscape" paperSize="1"/>
      </worksheet>
    `;

    const excelZip = createZipBuffer([
      { name: 'xl/workbook.xml', data: '<workbook/>', method: 0 },
      { name: 'xl/worksheets/sheet1.xml', data: sheet1Xml, method: 0 },
      { name: 'xl/worksheets/sheet2.xml', data: sheet2Xml, method: 0 }
    ]);

    assert.equal(ExcelDecoder.probe(excelZip), true);

    const doc = ExcelDecoder.decode(excelZip);
    assert.equal(doc.pages.length, 2);

    // Sheet 1: portrait 612 x 792
    assert.equal(doc.pages[0].widthPts, 612);
    assert.equal(doc.pages[0].heightPts, 792);

    // Sheet 2: landscape 792 x 612
    assert.equal(doc.pages[1].widthPts, 792);
    assert.equal(doc.pages[1].heightPts, 612);
  });

  test('PptDecoder: Converts slide EMUs to PDF points (16:9 widescreen & 4:3 standard)', () => {
    // 16:9 Widescreen: 12,192,000 x 6,858,000 EMUs = 960 x 540 pt
    const presXml = `<?xml version="1.0" encoding="UTF-8"?>
      <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldSz cx="12192000" cy="6858000"/>
      </p:presentation>
    `;

    const pptZip = createZipBuffer([
      { name: 'ppt/presentation.xml', data: presXml, method: 0 },
      { name: 'ppt/slides/slide1.xml', data: '<p:sld/>', method: 0 },
      { name: 'ppt/slides/slide2.xml', data: '<p:sld/>', method: 0 },
      { name: 'ppt/slides/slide3.xml', data: '<p:sld/>', method: 0 }
    ]);

    assert.equal(PptDecoder.probe(pptZip), true);

    const doc = PptDecoder.decode(pptZip);
    assert.equal(doc.pages.length, 3);

    for (let i = 0; i < 3; i++) {
      assert.equal(doc.pages[i].widthPts, 960);
      assert.equal(doc.pages[i].heightPts, 540);
    }
  });
});
