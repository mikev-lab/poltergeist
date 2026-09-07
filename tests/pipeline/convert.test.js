/**
 * @file convert.test.js
 * @description End-to-end integration tests for the unified convert pipeline.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { convert, ExportFormat } from '../../src/pipeline/convert.js';
import { PngDecoder, computeCrc32 } from '../../src/ingestion/raster/png/png_decoder.js';
import { TiffWriter } from '../../src/export/tiff/tiff_writer.js';
import { TiffDecoder } from '../../src/ingestion/raster/tiff/tiff_decoder.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../src/types/image.js';

/**
 * Builds a simple PNG buffer.
 */
function createTestPng(width, height, dpi = 300) {
  const scanlines = new Uint8Array(height * (1 + width * 3));
  let pos = 0;
  for (let y = 0; y < height; y++) {
    scanlines[pos++] = 0; // Filter None
    for (let x = 0; x < width; x++) {
      scanlines[pos++] = 200; // R
      scanlines[pos++] = 100; // G
      scanlines[pos++] = 50;  // B
    }
  }

  const chunks = [];
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  function makeChunk(type, data) {
    const h = Buffer.alloc(8);
    h.writeUInt32BE(data.length, 0);
    h.write(type, 4, 4, 'ascii');
    const crcBuf = Buffer.concat([h.subarray(4, 8), data]);
    const crc = computeCrc32(crcBuf, 0, crcBuf.length);
    const f = Buffer.alloc(4);
    f.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([h, data, f]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9); // RGB
  chunks.push(makeChunk('IHDR', ihdr));

  const phys = Buffer.alloc(9);
  const ppm = Math.round(dpi / 0.0254);
  phys.writeUInt32BE(ppm, 0);
  phys.writeUInt32BE(ppm, 4);
  phys.writeUInt8(1, 8);
  chunks.push(makeChunk('pHYs', phys));

  const idat = zlib.deflateSync(Buffer.from(scanlines));
  chunks.push(makeChunk('IDAT', idat));
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

describe('Unified Conversion Pipeline: End-to-End Workflows', () => {
  it('E2E Workflow 1: Ingest PNG RGB -> Auto-convert to CMYK + TAC 300% -> Export PDF/X-1a', () => {
    const pngBuffer = createTestPng(20, 20, 300);

    const pdfBytes = convert(pngBuffer, {
      targetFormat: ExportFormat.PDF_X1A,
      tacMax: 300,
      title: 'Flyer Prepress'
    });

    const pdfStr = Buffer.from(pdfBytes).toString('latin1');

    // Asserts
    assert.ok(pdfStr.startsWith('%PDF-1.3'));
    assert.ok(pdfStr.includes('/ColorSpace /DeviceCMYK'));
    assert.ok(pdfStr.includes('/GTS_PDFXVersion (PDF/X-1a:2001)'));
    assert.ok(pdfStr.includes('/OutputIntent'));
    assert.ok(pdfStr.includes('%%EOF'));
  });

  it('E2E Workflow 2: Ingest TIFF CMYK -> Export discrete separation plates (tiffsep)', () => {
    const cmykData = new Uint8Array(10 * 10 * 4);
    cmykData.fill(128);

    const cmykImage = new RasterImage({
      width: 10,
      height: 10,
      channels: 4,
      colorSpace: ColorSpaceType.CMYK,
      data: cmykData
    });

    const tiffBuffer = TiffWriter.write(cmykImage);

    const plates = convert(tiffBuffer, {
      targetFormat: ExportFormat.TIFFSEP,
      jobName: 'brochure'
    });

    assert.ok(plates instanceof Map);
    assert.ok(plates.has('brochure_Cyan.tif'));
    assert.ok(plates.has('brochure_Magenta.tif'));
    assert.ok(plates.has('brochure_Yellow.tif'));
    assert.ok(plates.has('brochure_Black.tif'));
    assert.ok(plates.has('brochure_composite.tif'));

    // Validate Cyan plate content
    const cyanTiff = plates.get('brochure_Cyan.tif');
    const cyanImg = TiffDecoder.decode(cyanTiff);
    assert.equal(cyanImg.width, 10);
    assert.equal(cyanImg.height, 10);
    assert.equal(cyanImg.channels, 1);
    assert.equal(cyanImg.data[0], 128);
  });

  it('E2E Workflow 3: Ingest PNG placed at 600 DPI -> Prepress downsampling to 300 DPI -> Export PDF/X-4', () => {
    // 200x200 image at 600 DPI should be downsampled to 100x100 at 300 DPI
    const pngBuffer = createTestPng(200, 200, 600);

    const pdfBytes = convert(pngBuffer, {
      targetFormat: ExportFormat.PDF_X4,
      downsample: true,
      targetDpi: 300
    });

    const pdfStr = Buffer.from(pdfBytes).toString('latin1');
    assert.ok(pdfStr.startsWith('%PDF-1.6'));
    assert.ok(pdfStr.includes('/GTS_PDFXVersion (PDF/X-4)'));
    assert.ok(pdfStr.includes('/Width 100'));
    assert.ok(pdfStr.includes('/Height 100'));
  });
});
