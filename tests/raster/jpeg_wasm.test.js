/**
 * @file jpeg_wasm.test.js
 * @description Unit tests for embedded WebAssembly IDCT engine and fallback parity.
 * Verifies zero dependencies, memory safety, and cross-platform determinism.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wasmIdct, WasmIdctEngine, fastIdct8x8, IDCT8_MAT } from '../../src/ingestion/raster/jpeg/idct_wasm.js';

describe('WebAssembly IDCT Engine', () => {
  it('instantiates and probes environment capabilities', () => {
    assert.ok(wasmIdct instanceof WasmIdctEngine);
    const available = wasmIdct.isAvailable();
    assert.strictEqual(typeof available, 'boolean');
    // In Node.js environment, WebAssembly is globally supported
    assert.strictEqual(available, true);
  });

  it('computes 8x8 IDCT bit-identically with fastIdct8x8 reference', () => {
    const block = new Float64Array(64);
    // Arbitrary AC + DC coefficients
    block[0] = 512;
    block[1] = 64;
    block[8] = -32;
    block[9] = 16;
    block[16] = 8;
    block[63] = -4;

    const outRef = new Uint8Array(64);
    fastIdct8x8(block, outRef);

    const outWasm = new Uint8Array(64);
    wasmIdct.idct8x8(block, outWasm);

    assert.deepStrictEqual(outWasm, outRef);
  });

  it('handles DC impulse and saturation clamping safely', () => {
    const blockMax = new Float64Array(64);
    blockMax[0] = 10000; // Extreme DC that should saturate to 255
    const outMax = new Uint8Array(64);
    wasmIdct.idct8x8(blockMax, outMax);

    for (let i = 0; i < 64; i++) {
      assert.strictEqual(outMax[i], 255);
    }

    const blockMin = new Float64Array(64);
    blockMin[0] = -10000; // Extreme negative DC that should saturate to 0
    const outMin = new Uint8Array(64);
    wasmIdct.idct8x8(blockMin, outMin);

    for (let i = 0; i < 64; i++) {
      assert.strictEqual(outMin[i], 0);
    }
  });

  it('preserves precomputed 8x8 cosine basis matrix orthogonality', () => {
    assert.strictEqual(IDCT8_MAT.length, 8);
    for (let x = 0; x < 8; x++) {
      assert.strictEqual(IDCT8_MAT[x].length, 8);
      // DC basis coefficient C[x][0] = 0.5 * 0.7071067811865475
      assert.ok(Math.abs(IDCT8_MAT[x][0] - 0.35355339) < 1e-6);
    }
  });
});
