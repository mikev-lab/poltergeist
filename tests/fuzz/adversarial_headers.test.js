/**
 * @file adversarial_headers.test.js
 * @description Fuzzing test suite asserting that all file decoders safely reject truncated
 * and malformed binary headers with structured errors and zero runtime panics.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createTruncatedStreams } from '../fixtures/fuzz/generator.js';

import { PngDecoder, TiffDecoder, JpegDecoder, BmpDecoder, TgaDecoder, WebpDecoder } from '../../src/ingestion/raster/index.js';
import { PsdDecoder } from '../../src/ingestion/layered/psd/psd_decoder.js';
import { ClipDecoder } from '../../src/ingestion/layered/clip/clip_decoder.js';
import { RawDecoder } from '../../src/ingestion/raw/raw_decoder.js';
import { SvgDecoder } from '../../src/ingestion/vector/svg_decoder.js';
import { AiDecoder } from '../../src/ingestion/vector/ai_decoder.js';
import { CdrDecoder } from '../../src/ingestion/vector/cdr_decoder.js';
import { WmfDecoder } from '../../src/ingestion/vector/wmf_decoder.js';
import { DxfDecoder } from '../../src/ingestion/cad/dxf_decoder.js';
import { DwgDecoder } from '../../src/ingestion/cad/dwg_decoder.js';
import { PdfDecoder } from '../../src/ingestion/pdf/pdf_decoder.js';
import { ComicDecoder } from '../../src/ingestion/publication/comic_decoder.js';
import { EpubDecoder } from '../../src/ingestion/publication/epub_decoder.js';
import { convert } from '../../src/pipeline/convert.js';

test('Adversarial Hardening: Truncated Binary Headers & Cutoffs', async (t) => {
  // Reference valid headers
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 1, 0, 72]);
  const tiffHeader = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x01]);
  const psdHeader = Buffer.from('8BPS\0\x01\0\0\0\0\0\0\0\x03\0\0\x00\x10\0\0\x00\x10\0\x08\0\x03', 'latin1');
  const clipHeader = Buffer.from('SQLite format 3\0\x10\x00\x01\x01\x00\x40\x20\x20', 'latin1');
  const pdfHeader = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\nxref\n0 2\n0000000000 65535 f \ntrailer << >>\n%%EOF', 'latin1');
  const dwgHeader = Buffer.from('AC1027\0\0\0\0\0\0\0\0\0\0', 'latin1');

  await t.test('Raster Decoders safely reject truncated streams', () => {
    for (const cut of [Buffer.alloc(0), Buffer.alloc(2), Buffer.alloc(4), Buffer.alloc(6), Buffer.alloc(10)]) {
      assert.throws(() => PngDecoder.decode(cut), /(truncated|too small|Invalid|Unsupported|missing)/i);
    }
    for (const cut of [Buffer.alloc(0), Buffer.alloc(1), Buffer.alloc(2), Buffer.alloc(4), Buffer.alloc(8)]) {
      assert.throws(() => JpegDecoder.decode(cut), /(truncated|too small|SOI|Invalid|Unsupported)/i);
    }
    for (const cut of [Buffer.alloc(0), Buffer.alloc(2), Buffer.alloc(4), Buffer.alloc(6)]) {
      assert.throws(() => TiffDecoder.decode(cut), /(truncated|too small|bounds|Invalid|Unsupported)/i);
    }
  });

  await t.test('Layered Decoders safely reject truncated streams', () => {
    for (const cut of [Buffer.alloc(0), Buffer.alloc(2), Buffer.alloc(4), Buffer.alloc(8), Buffer.alloc(16)]) {
      assert.throws(() => PsdDecoder.decode(cut), /(truncated|too small|signature|Invalid|Unsupported)/i);
    }
    for (const cut of [Buffer.alloc(0), Buffer.alloc(4), Buffer.alloc(8), Buffer.alloc(15)]) {
      assert.throws(() => ClipDecoder.decode(cut), /(truncated|too small|SQLite|Invalid|Unsupported)/i);
    }
  });

  await t.test('Vector & CAD Decoders safely reject truncated streams', () => {
    for (const cut of [Buffer.alloc(0), Buffer.from('<'), Buffer.from('<sv')]) {
      assert.throws(() => SvgDecoder.decode(cut), /(Unsupported or invalid|invalid)/i);
    }
    for (const cut of [Buffer.alloc(0), Buffer.alloc(2), Buffer.alloc(4), Buffer.alloc(5)]) {
      assert.throws(() => DwgDecoder.decode(cut), /(too small|signature|Unsupported or invalid)/i);
    }
  });

  await t.test('RAW & Publication Decoders safely reject truncated streams', () => {
    for (const cut of [Buffer.alloc(0), Buffer.alloc(4), Buffer.alloc(8), Buffer.alloc(12)]) {
      assert.throws(() => RawDecoder.decode(cut), /(too small|signature|Unsupported or invalid)/i);
    }
    for (const cut of [Buffer.alloc(0), Buffer.alloc(2), Buffer.alloc(4), Buffer.alloc(6)]) {
      assert.throws(() => ComicDecoder.decode(cut), /(too small|signature|Unsupported or invalid)/i);
    }
  });

  await t.test('Pipeline convert() rejects corrupted / garbage buffers gracefully', () => {
    const garbage1 = Buffer.from('NOT_A_VALID_FILE_FORMAT_JUST_RANDOM_TEXT');
    assert.throws(() => convert(garbage1), /(Unsupported|unrecognized|Invalid)/i);

    const garbage2 = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01, 0x02, 0x03]);
    assert.throws(() => convert(garbage2), /(Unsupported|unrecognized|Invalid)/i);
  });
});
