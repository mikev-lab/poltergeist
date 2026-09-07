/**
 * @file decompression_bomb.test.js
 * @description Adversarial security tests asserting defenses against Zip-Slip path traversal
 * and decompression bombs (extreme expansion ratios & allocation threshold limits).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ZipReader } from '../../src/ingestion/common/zip_reader.js';
import { createZipSlipArchive, createDecompressionBombArchive } from '../fixtures/fuzz/generator.js';

test('Security & Adversarial: Zip-Slip & Decompression Bomb Defenses', async (t) => {
  await t.test('Zip-Slip: Detects and rejects directory traversal (../../evil.txt)', () => {
    const maliciousZip = createZipSlipArchive('../../evil.txt');
    assert.throws(
      () => new ZipReader(maliciousZip),
      /Security Violation: Disallowed path traversal/i
    );
  });

  await t.test('Zip-Slip: Detects and rejects leading slash (/etc/passwd)', () => {
    const maliciousZip = createZipSlipArchive('/etc/passwd');
    assert.throws(
      () => new ZipReader(maliciousZip),
      /Security Violation: Disallowed path traversal/i
    );
  });

  await t.test('Zip-Slip: Detects and rejects Windows backslash path traversal (..\\evil.txt)', () => {
    const maliciousZip = createZipSlipArchive('..\\evil.txt');
    assert.throws(
      () => new ZipReader(maliciousZip),
      /Security Violation: Disallowed path traversal/i
    );
  });

  await t.test('Decompression Bomb: Rejects archive entry claiming >512MB threshold', () => {
    const bombZip = createDecompressionBombArchive();
    const reader = new ZipReader(bombZip);
    assert.throws(
      () => reader.read('bomb.txt'),
      /uncompressed size.*exceeds 512MB threshold/i
    );
  });
});
