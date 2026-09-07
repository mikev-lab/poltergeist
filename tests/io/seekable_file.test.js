/**
 * @file seekable_file.test.js
 * @description Comprehensive unit tests for SeekableSource, FileSeekableSource,
 * and 5 GB+ random-access streaming in Poltergeist.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SeekableSource, BufferSeekableSource, createSeekableBytes } from '../../src/io/seekable.js';
import { FileSeekableSource } from '../../src/io/file_seekable.js';
import { PdfDecoder } from '../../src/ingestion/pdf/pdf_decoder.js';
import { convert, ExportFormat } from '../../src/pipeline/convert.js';

describe('SeekableSource & FileSeekableSource', () => {
  test('BufferSeekableSource: readSync, slice, and out-of-bounds guards', () => {
    const raw = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const src = new BufferSeekableSource(raw);

    assert.equal(src.size, 8);
    assert.deepEqual(src.readSync(0, 4), new Uint8Array([10, 20, 30, 40]));
    assert.deepEqual(src.readSync(4, 4), new Uint8Array([50, 60, 70, 80]));
    assert.deepEqual(src.readSync(6, 10), new Uint8Array([70, 80]), 'Clamps length to available bytes');

    // Slice
    const sub = src.slice(2, 4);
    assert.equal(sub.size, 4);
    assert.deepEqual(sub.readSync(0, 2), new Uint8Array([30, 40]));

    // Out of bounds
    assert.throws(() => src.readSync(-1, 2), { name: 'RangeError' });
    assert.throws(() => src.readSync(99, 2), { name: 'RangeError' });
  });

  test('FileSeekableSource: sliding window cache, readSync, slice, and close', () => {
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `poltergeist_seek_${Date.now()}.bin`);
    
    // Write 256 KB test file
    const data = Buffer.alloc(256 * 1024);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256;
    }
    fs.writeFileSync(tmpFile, data);

    try {
      // Use small 4 KB window size to test sliding window cache hits and misses
      const fileSrc = new FileSeekableSource(tmpFile, { windowSize: 4096 });
      assert.equal(fileSrc.size, 256 * 1024);

      // Read chunk within first window (cache fill)
      const c1 = fileSrc.readSync(0, 16);
      assert.equal(c1.length, 16);
      assert.equal(c1[0], 0);
      assert.equal(c1[15], 15);

      // Read chunk within same window (cache hit)
      const c2 = fileSrc.readSync(100, 16);
      assert.equal(c2[0], 100);

      // Read chunk beyond window (cache miss, reload)
      const c3 = fileSrc.readSync(10000, 16);
      assert.equal(c3[0], 10000 % 256);

      // Large read exceeding window size (bypasses cache directly)
      const cLarge = fileSrc.readSync(1000, 8192);
      assert.equal(cLarge.length, 8192);
      assert.equal(cLarge[0], 1000 % 256);

      // Slice / windowed sub-source
      const sub = fileSrc.slice(500, 1000);
      assert.equal(sub.size, 1000);
      const subChunk = sub.readSync(0, 10);
      assert.equal(subChunk[0], 500 % 256);

      fileSrc.close();
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  });

  test('createSeekableBytes WindowedProxy: index access and subarray across chunks', () => {
    const raw = Buffer.alloc(64 * 1024);
    for (let i = 0; i < raw.length; i++) {
      raw[i] = (i * 7) % 256;
    }
    const src = new BufferSeekableSource(raw);
    const proxy = createSeekableBytes(src);

    assert.equal(proxy.length, 64 * 1024);
    assert.equal(proxy[0], 0);
    assert.equal(proxy[1], 7);
    assert.equal(proxy[100], (100 * 7) % 256);

    const sub = proxy.subarray(10, 20);
    assert.equal(sub.length, 10);
    assert.equal(sub[0], (10 * 7) % 256);
  });

  test('Simulated 5 GB+ Random-Access: Offsets exceeding 4 GiB threshold operate safely', () => {
    // Mock SeekableSource simulating a 6 GB file (6 * 1024^3 bytes)
    const SIX_GB = 6 * 1024 * 1024 * 1024;
    class MockHugeSeekableSource extends SeekableSource {
      get size() {
        return SIX_GB;
      }
      readSync(offset, length) {
        if (offset < 0 || offset > SIX_GB) throw new RangeError('out of bounds');
        // Return synthetic byte pattern keyed to offset
        const buf = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
          buf[i] = (offset + i) % 256;
        }
        return buf;
      }
    }

    const hugeSource = new MockHugeSeekableSource();
    assert.equal(hugeSource.size, SIX_GB);

    const hugeProxy = createSeekableBytes(hugeSource);
    assert.equal(hugeProxy.length, SIX_GB);

    // Read byte at offset 5 GB (5,368,709,120), exceeding 4 GiB Uint8Array allocation limit!
    const FIVE_GB_OFFSET = 5 * 1024 * 1024 * 1024;
    const b = hugeProxy[FIVE_GB_OFFSET];
    assert.equal(b, FIVE_GB_OFFSET % 256);

    const tail = hugeProxy.subarray(SIX_GB - 100, SIX_GB);
    assert.equal(tail.length, 100);
    assert.equal(tail[0], (SIX_GB - 100) % 256);
  });

  test('PdfDecoder & convert() with direct file path input', () => {
    const samplePdfPath = '/Users/mike/.gemini/antigravity-ide/brain/efdccc9c-66bf-4ea0-888b-1c3b0590491d/.user_uploaded/media_1788772459505.pdf';
    if (!fs.existsSync(samplePdfPath)) return;

    // 1. PdfDecoder.decode with file path
    const doc = PdfDecoder.decode(samplePdfPath);
    assert.equal(doc.pages.length, 1);
    assert.ok(doc.pages[0].width > 0);

    // 2. convert() with file path
    const jpegOut = convert(samplePdfPath, {
      targetFormat: ExportFormat.JPEG,
      targetDpi: 72
    });
    assert.ok(jpegOut instanceof Uint8Array);
    assert.equal(jpegOut[0], 0xff);
    assert.equal(jpegOut[1], 0xd8);
    assert.equal(jpegOut[2], 0xff);
  });
});
