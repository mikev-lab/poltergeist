/**
 * @file idml_decoder.test.js
 * @description Unit tests for InDesign IDML package ingestion: spreads, bleeds, page boxes, and multi-page flows.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { IdmlDecoder } from '../../src/ingestion/document/idml/idml_decoder.js';

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

describe('IdmlDecoder: InDesign IDML Package Ingestion', () => {
  test('Golden Path: Decodes spreads, bleed dimensions, and page boxes', () => {
    const spreadXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <idPkg:Spread xmlns:idPkg="http://schemas.adobe.com/idml/1.0/packaging">
        <Spread Self="sp1" BleedTop="9" BleedBottom="9" BleedInside="9" BleedOutside="9">
          <Page Self="p1" GeometricBounds="0 0 792 612" ItemTransform="1 0 0 1 0 0" />
        </Spread>
      </idPkg:Spread>
    `;

    const idmlBuffer = createZipBuffer([
      { name: 'mimetype', data: 'application/vnd.adobe.indesign-idml-package', method: 0 },
      { name: 'designmap.xml', data: '<Document />', method: 8 },
      { name: 'Spreads/Spread_1.xml', data: spreadXml, method: 8 }
    ]);

    assert.equal(IdmlDecoder.probe(idmlBuffer), true);

    const doc = IdmlDecoder.decode(idmlBuffer);
    assert.equal(doc.pages.length, 1);

    const page = doc.pages[0];
    assert.equal(page.widthPts, 612);
    assert.equal(page.heightPts, 792);

    // Bounding boxes check
    const { mediaBox, trimBox, bleedBox } = page.pageBox;
    assert.deepEqual(trimBox, [0, 0, 612, 792]);
    assert.deepEqual(bleedBox, [-9, -9, 621, 801]);
  });

  test('Golden Path: Decodes multi-spread documents in sequential order', () => {
    const spread1 = `
      <Spread BleedTop="9" BleedBottom="9">
        <Page GeometricBounds="0 0 792 612" />
      </Spread>
    `;
    const spread2 = `
      <Spread BleedTop="12" BleedBottom="12">
        <Page GeometricBounds="0 0 792 612" />
      </Spread>
    `;

    const multiIdml = createZipBuffer([
      { name: 'designmap.xml', data: '<Document />', method: 0 },
      { name: 'Spreads/Spread_b.xml', data: spread2, method: 0 },
      { name: 'Spreads/Spread_a.xml', data: spread1, method: 0 }
    ]);

    const doc = IdmlDecoder.decode(multiIdml);
    assert.equal(doc.pages.length, 2);
    assert.equal(doc.pages[0].pageIndex, 0);
    assert.equal(doc.pages[1].pageIndex, 1);
  });
});
