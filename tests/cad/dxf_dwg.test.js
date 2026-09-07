/**
 * @file dxf_dwg.test.js
 * @description Comprehensive unit and adversarial tests for AutoCAD DXF and DWG schematic decoders.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DxfDecoder, CAD_PAPER_SIZES, ACI_PALETTE } from '../../src/ingestion/cad/dxf_decoder.js';
import { DwgDecoder } from '../../src/ingestion/cad/dwg_decoder.js';
import { probeCadFormat, decodeCad } from '../../src/ingestion/cad/index.js';
import { Document } from '../../src/types/document.js';

test('DxfDecoder: ASCII Group-Code Tokenizer & Entity Parsing', async (t) => {
  await t.test('Sniffs and decodes DXF stream with LINE, CIRCLE, and LWPOLYLINE', () => {
    const dxfString = `0
SECTION
2
ENTITIES
0
LINE
10
0.0
20
0.0
11
100.0
21
100.0
62
1
0
CIRCLE
10
50.0
20
50.0
40
25.0
62
3
0
LWPOLYLINE
90
3
70
1
10
10.0
20
10.0
10
20.0
20
10.0
10
20.0
20
20.0
0
ENDSEC
0
EOF`;

    assert.equal(DxfDecoder.probe(dxfString), true);

    const doc = DxfDecoder.decode(dxfString, { paperSize: 'ARCH_D' });
    assert.ok(doc instanceof Document);
    assert.equal(doc.pageCount, 1);

    const page = doc.getPage(1);
    // Arch D dimensions: 2592 x 1728 pt (36x24 in)
    assert.equal(page.width, 2592);
    assert.equal(page.height, 1728);
    // 3 entities: line, circle, lwpolyline
    assert.equal(page.paths.length, 3);
    assert.ok(page.metadata.scale > 0);
  });

  await t.test('Projects into ISO A1 paper size', () => {
    const dxfString = `0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n50\n21\n50\n0\nENDSEC\n0\nEOF`;
    const doc = DxfDecoder.decode(dxfString, { paperSize: 'ISO_A1' });
    const page = doc.getPage(1);
    assert.equal(page.width, 2384);
    assert.equal(page.height, 1684);
  });

  await t.test('Adversarial: Handles empty entities section and malformed codes gracefully', () => {
    const emptyDxf = `0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF`;
    const doc = DxfDecoder.decode(emptyDxf);
    assert.equal(doc.pageCount, 1);
    assert.equal(doc.getPage(1).paths.length, 0);

    assert.throws(() => DxfDecoder.decode('NOT_A_DXF'), /Unsupported or invalid/);
  });
});

test('DwgDecoder: Binary Header Version Sniffing & Ingestion', async (t) => {
  await t.test('Sniffs AutoCAD 2000 (AC1015), 2013 (AC1027), 2018 (AC1032) headers', () => {
    const dwg2000 = Buffer.from('AC1015\0\0\0\0\0\0\0\0\0\0', 'latin1');
    const dwg2018 = Buffer.from('AC1032\0\0\0\0\0\0\0\0\0\0', 'latin1');
    assert.equal(DwgDecoder.probe(dwg2000), true);
    assert.equal(DwgDecoder.probe(dwg2018), true);
    assert.equal(DwgDecoder.probe(new Uint8Array(4)), false);
  });

  await t.test('Decodes DWG binary stream into Document with version metadata', () => {
    const dwg = Buffer.from('AC1027\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0', 'latin1');
    const doc = DwgDecoder.decode(dwg);
    assert.ok(doc instanceof Document);
    assert.equal(doc.pageCount, 1);
    assert.equal(doc.getPage(1).metadata.versionSignature, 'AC1027');
    assert.ok(doc.creator.includes('AutoCAD 2013'));
  });

  await t.test('Adversarial: Throws on invalid DWG binary signature', () => {
    assert.throws(() => DwgDecoder.decode(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])), /Unsupported or invalid/);
  });
});

test('Unified CAD Router: probeCadFormat & decodeCad', async (t) => {
  await t.test('Routes DXF text and DWG buffer correctly', () => {
    const dxf = '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF';
    assert.equal(probeCadFormat(dxf), 'dxf');
    const docDxf = decodeCad(dxf);
    assert.ok(docDxf instanceof Document);

    const dwg = Buffer.from('AC1018\0\0\0\0\0\0\0\0\0\0', 'latin1');
    assert.equal(probeCadFormat(dwg), 'dwg');
    const docDwg = decodeCad(dwg);
    assert.ok(docDwg instanceof Document);
  });
});
