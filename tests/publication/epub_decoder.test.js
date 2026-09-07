/**
 * @file epub_decoder.test.js
 * @description Comprehensive unit tests for EPUB electronic publication ingestion,
 * OCF container parsing, spine linear reading sequence, and Dublin Core metadata.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { EpubDecoder } from '../../src/ingestion/publication/epub_decoder.js';
import { probePublicationFormat, decodePublication } from '../../src/ingestion/publication/index.js';
import { Document } from '../../src/types/document.js';

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

    const localOffset = offset;
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

  const centralOffset = offset;
  let centralSize = 0;
  for (const ch of centralHeaders) centralSize += ch.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

test('EpubDecoder: OCF Container & Spine Reading Sequence', async (t) => {
  await t.test('Decodes multi-chapter EPUB into sequential PageRecords', () => {
    const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Principles of Prepress</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
  </metadata>
  <manifest>
    <item id="ch1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

    const chap1Xhtml = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter 1: Zero Dependencies</h1><p>Poltergeist memory-safe architecture.</p></body></html>`;
    const chap2Xhtml = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter 2: Prepress Color</h1><p>Tetrahedral interpolation.</p></body></html>`;

    const epubBuf = createZipBuffer([
      { name: 'mimetype', data: 'application/epub+zip' },
      { name: 'META-INF/container.xml', data: containerXml },
      { name: 'OEBPS/content.opf', data: contentOpf },
      { name: 'OEBPS/chap1.xhtml', data: chap1Xhtml },
      { name: 'OEBPS/chap2.xhtml', data: chap2Xhtml }
    ]);

    assert.equal(EpubDecoder.probe(epubBuf), true);
    assert.equal(probePublicationFormat(epubBuf), 'epub');

    const doc = decodePublication(epubBuf);
    assert.ok(doc instanceof Document);
    assert.equal(doc.title, 'Principles of Prepress');
    assert.ok(doc.creator.includes('Ada Lovelace'));
    assert.equal(doc.pageCount, 2);

    const page1 = doc.getPage(1);
    const page2 = doc.getPage(2);
    assert.ok(page1.text.includes('Chapter 1'));
    assert.ok(page2.text.includes('Chapter 2'));
  });

  await t.test('Adversarial: Throws if missing META-INF/container.xml', () => {
    const invalidZip = createZipBuffer([
      { name: 'mimetype', data: 'application/epub+zip' },
      { name: 'some_other_file.txt', data: 'hello' }
    ]);
    assert.throws(() => EpubDecoder.decode(invalidZip), /missing 'META-INF\/container.xml'/);
  });
});
