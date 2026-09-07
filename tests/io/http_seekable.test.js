/**
 * @file http_seekable.test.js
 * @description Unit tests for HttpSeekableSource using a zero-dependency local HTTP Range server.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpSeekableSource } from '../../src/io/http_seekable.js';

describe('HttpSeekableSource: Cloud S3 & HTTP Range Ingestion', () => {
  let server;
  let serverUrl;
  let requestCount = 0;
  const testPayload = Buffer.alloc(128 * 1024); // 128 KB test file

  before(async () => {
    // Fill test payload with deterministic pattern
    for (let i = 0; i < testPayload.length; i++) {
      testPayload[i] = (i * 13) % 256;
    }

    server = http.createServer((req, res) => {
      requestCount++;
      const rangeHeader = req.headers['range'];

      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Accept-Ranges': 'bytes',
          'Content-Length': testPayload.length
        });
        res.end();
        return;
      }

      if (rangeHeader) {
        // e.g. "bytes=0-1023" or "bytes=1000-1999"
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        if (match) {
          let start = match[1] ? parseInt(match[1], 10) : 0;
          let end = match[2] ? parseInt(match[2], 10) : testPayload.length - 1;

          if (!match[1] && match[2]) {
            // Suffix range: bytes=-2048
            const suffixLen = parseInt(match[2], 10);
            start = Math.max(0, testPayload.length - suffixLen);
            end = testPayload.length - 1;
          }

          start = Math.max(0, Math.min(start, testPayload.length - 1));
          end = Math.max(start, Math.min(end, testPayload.length - 1));

          const chunk = testPayload.subarray(start, end + 1);
          res.writeHead(206, {
            'Content-Type': 'application/octet-stream',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${testPayload.length}`,
            'Content-Length': chunk.length
          });
          res.end(chunk);
          return;
        }
      }

      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Content-Length': testPayload.length
      });
      res.end(testPayload);
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${addr.port}/test.pdf`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  test('HttpSeekableSource.open(): initializes size and prefetches initial ranges', async () => {
    requestCount = 0;
    const source = await HttpSeekableSource.open(serverUrl);
    assert.equal(source.size, 128 * 1024);
    assert.ok(requestCount >= 1, 'Should have issued probe/prefetch requests');

    // Read initial bytes (should be satisfied from cache without new request)
    const initialReqCount = requestCount;
    const header = await source.read(0, 16);
    assert.equal(header.length, 16);
    assert.equal(header[0], testPayload[0]);
    assert.equal(header[15], testPayload[15]);
    assert.equal(requestCount, initialReqCount, 'Cache hit should not trigger network request');

    source.close();
  });

  test('read(): fetches targeted byte ranges over HTTP Range request', async () => {
    const source = await HttpSeekableSource.open(serverUrl);

    // Read arbitrary range in the middle
    const offset = 64 * 1024;
    const length = 512;
    const data = await source.read(offset, length);

    assert.equal(data.length, length);
    assert.deepEqual(data, new Uint8Array(testPayload.subarray(offset, offset + length)));

    // Verify readSync from cache
    const syncData = source.readSync(offset, 64);
    assert.deepEqual(syncData, new Uint8Array(testPayload.subarray(offset, offset + 64)));

    // Out-of-bounds guards
    await assert.rejects(
      async () => source.read(-1, 10),
      { name: 'RangeError' }
    );
    await assert.rejects(
      async () => source.read(9999999, 10),
      { name: 'RangeError' }
    );

    source.close();
  });
});
