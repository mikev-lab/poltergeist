import test from 'node:test';
import assert from 'node:assert/strict';
import { Document, PageRecord } from '../../src/types/document.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../src/types/image.js';
import { convert, convertParallel } from '../../src/pipeline/convert.js';
import { WorkerPool } from '../../src/pipeline/worker_pool.js';

function createSyntheticDoc(numPages = 4) {
  const pages = [];
  for (let i = 1; i <= numPages; i++) {
    const w = 100;
    const h = 100;
    const data = new Uint8Array(w * h * 3);
    for (let p = 0; p < w * h; p++) {
      data[p * 3] = (i * 40) % 256;
      data[p * 3 + 1] = (p * 5) % 256;
      data[p * 3 + 2] = 200;
    }

    const img = new RasterImage({
      width: w,
      height: h,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      dpiX: 72,
      dpiY: 72,
      data
    });

    pages.push(new PageRecord({
      pageNumber: i,
      width: 612,
      height: 792,
      dpi: 72,
      image: img
    }));
  }

  return new Document({
    title: 'Synthetic Parallel Test',
    pages
  });
}

test('Parallel Pipeline: WorkerPool lifecycle and error handling', async () => {
  const pool = new WorkerPool({ maxWorkers: 2 });
  assert.equal(pool.workers.length, 2);
  assert.equal(pool.idleWorkers.length, 2);

  // Terminate pool
  await pool.terminate();
  assert.equal(pool.closed, true);

  // Calling execute after terminate rejects
  await assert.rejects(async () => {
    await pool.execute({ mode: 'process_page', pageData: null, options: {} });
  }, /WorkerPool is closed/);
});

test('Parallel Pipeline: Multi-page splitPages with WorkerPool', async () => {
  const doc = createSyntheticDoc(4);

  const singleThreaded = convert(doc, {
    targetFormat: 'jpeg',
    splitPages: true
  });

  const multiThreaded = await convertParallel(doc, {
    targetFormat: 'jpeg',
    splitPages: true,
    maxWorkers: 2
  });

  assert.equal(singleThreaded.size, 4);
  assert.equal(multiThreaded.size, 4);

  for (let i = 1; i <= 4; i++) {
    const filename = `page_${i}.jpg`;
    assert.ok(singleThreaded.has(filename), `Missing single-threaded ${filename}`);
    assert.ok(multiThreaded.has(filename), `Missing multi-threaded ${filename}`);

    const singleBuf = singleThreaded.get(filename);
    const multiBuf = multiThreaded.get(filename);
    assert.deepEqual(new Uint8Array(multiBuf), new Uint8Array(singleBuf));
  }
});

test('Parallel Pipeline: Custom pageNaming callback with WorkerPool', async () => {
  const doc = createSyntheticDoc(3);

  const result = await convertParallel(doc, {
    targetFormat: 'jpeg',
    splitPages: true,
    pageNaming: (num) => `custom_sheet_${num}`,
    maxWorkers: 2
  });

  assert.equal(result.size, 3);
  assert.ok(result.has('custom_sheet_1.jpg'));
  assert.ok(result.has('custom_sheet_2.jpg'));
  assert.ok(result.has('custom_sheet_3.jpg'));
});

test('Parallel Pipeline: Multi-page combined PDF/X-1a with parallel: true option', async () => {
  const doc = createSyntheticDoc(3);

  const pdfSingle = convert(doc, {
    targetFormat: 'pdf/x-1a',
    jobName: 'test_pdf'
  });

  const pdfMultiPromise = convert(doc, {
    targetFormat: 'pdf/x-1a',
    jobName: 'test_pdf',
    parallel: true,
    maxWorkers: 2
  });

  assert.ok(pdfMultiPromise instanceof Promise);
  const pdfMulti = await pdfMultiPromise;

  assert.ok(pdfSingle instanceof Uint8Array);
  assert.ok(pdfMulti instanceof Uint8Array);
  assert.equal(pdfMulti.length, pdfSingle.length);
});

test('Parallel Pipeline: Single-page document bypasses worker pool', async () => {
  const doc = createSyntheticDoc(1);

  const result = await convertParallel(doc, {
    targetFormat: 'jpeg',
    jobName: 'single'
  });

  assert.ok(result instanceof Uint8Array);
});

test('Parallel Pipeline: Page range filtering in parallel mode', async () => {
  const doc = createSyntheticDoc(5);

  const result = await convertParallel(doc, {
    targetFormat: 'jpeg',
    splitPages: true,
    pages: [2, 4]
  });

  assert.equal(result.size, 2);
  assert.ok(result.has('page_2.jpg'));
  assert.ok(result.has('page_4.jpg'));
});

