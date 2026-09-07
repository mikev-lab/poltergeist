import { test, describe } from 'node:test';
import assert from 'node:assert';
import { IccProfile } from '../../src/color/icc/profile.js';
import { IccHeader } from '../../src/color/icc/header.js';
import { GammaCurve, ParametricCurve, SampledCurve } from '../../src/color/icc/trc.js';

describe('ICC Binary Profile Parser & Deserializer', () => {
  test('Golden Path: Generates and parses valid sRGB v4 Matrix/TRC profile', () => {
    const srgb = IccProfile.createSrgbProfile();
    assert.strictEqual(srgb.colorSpace, 'RGB ');
    assert.strictEqual(srgb.pcs, 'XYZ ');
    assert.strictEqual(srgb.header.versionMajor, 4);
    assert.strictEqual(srgb.header.signature, 'acsp');
    assert.strictEqual(srgb.isMatrixShaper(), true);
    assert.strictEqual(srgb.isLutBased(), false);

    // Verify matrix tags
    const rXYZ = srgb.getTag('rXYZ');
    const gXYZ = srgb.getTag('gXYZ');
    const bXYZ = srgb.getTag('bXYZ');
    assert(rXYZ !== null && gXYZ !== null && bXYZ !== null);
    assert(rXYZ.x > 0.4 && rXYZ.y > 0.2);

    // Verify TRC tags
    const rTRC = srgb.getTag('rTRC');
    assert(rTRC instanceof ParametricCurve);
    // Linear segment: f(0.02) = 0.02 / 12.92
    assert(Math.abs(rTRC.evaluate(0.02) - 0.02 / 12.92) < 1e-5);
    // Upper segment: f(0.5) ~ 0.214
    assert(rTRC.evaluate(0.5) > 0.2 && rTRC.evaluate(0.5) < 0.25);
    // Inverse identity: fInv(f(x)) = x
    assert(Math.abs(rTRC.evaluateInverse(rTRC.evaluate(0.75)) - 0.75) < 1e-5);
  });

  test('Golden Path: Generates and parses valid prepress CMYK LUT profile', () => {
    const cmyk = IccProfile.createCmykReferenceProfile();
    assert.strictEqual(cmyk.colorSpace, 'CMYK');
    assert.strictEqual(cmyk.pcs, 'Lab ');
    assert.strictEqual(cmyk.isLutBased(), true);
    assert.strictEqual(cmyk.hasTag('A2B0'), true);
    assert.strictEqual(cmyk.hasTag('B2A0'), true);

    const a2b0 = cmyk.getTag('A2B0');
    assert.strictEqual(a2b0.inChannels, 4);
    assert.strictEqual(a2b0.outChannels, 3);

    // CMYK (0,0,0,0) -> Paper White (L* ~ 100)
    const whiteLab = a2b0.evaluate([0, 0, 0, 0]);
    const whiteL = whiteLab[0] * 100.0;
    assert(whiteL > 95.0, `Expected white L* > 95, got ${whiteL}`);

    // CMYK (0,0,0,1) -> Solid Black (L* < 35)
    const blackLab = a2b0.evaluate([0, 0, 0, 1.0]);
    const blackL = blackLab[0] * 100.0;
    assert(blackL < 35.0, `Expected black L* < 35, got ${blackL}`);
  });

  test('Deep Edge Case: Rejects truncated buffer under 128 bytes', () => {
    const tiny = new Uint8Array(64);
    assert.throws(
      () => IccHeader.fromBuffer(tiny),
      /Buffer too small for ICC header/
    );
  });

  test('Deep Edge Case: Rejects invalid magic signature', () => {
    const srgb = IccProfile.createSrgbProfile();
    const raw = srgb.toBuffer().slice();
    // Corrupt signature 'acsp' at offset 36
    raw[36] = 0x58; // 'X'
    assert.throws(
      () => IccProfile.fromBuffer(raw),
      /Invalid ICC signature/
    );
  });

  test('Deep Edge Case: Rejects corrupted tag offset outside buffer bounds', () => {
    const srgb = IccProfile.createSrgbProfile();
    const raw = srgb.toBuffer().slice();
    // In tag directory, set offset of first tag to 999999
    const view = new DataView(raw.buffer);
    view.setUint32(136, 999999, false); // first tag offset at 132 + 4 = 136
    assert.throws(
      () => IccProfile.fromBuffer(raw),
      /bounds .* exceed buffer length/
    );
  });

  test('TRC Edge Cases: Sampled curve monotonicity and binary search inversion', () => {
    const table = [0.0, 0.05, 0.2, 0.45, 0.7, 0.9, 1.0];
    const curve = new SampledCurve(table);
    assert.strictEqual(curve.evaluate(0.0), 0.0);
    assert.strictEqual(curve.evaluate(1.0), 1.0);
    assert(Math.abs(curve.evaluate(0.5) - 0.45) < 1e-5);

    // Inversion
    const inv = curve.evaluateInverse(0.45);
    assert(Math.abs(inv - 0.5) < 1e-4);
  });

  test('TRC Edge Cases: Gamma curve boundary precision', () => {
    const gamma = new GammaCurve(2.2);
    assert.strictEqual(gamma.evaluate(0.0), 0.0);
    assert.strictEqual(gamma.evaluate(1.0), 1.0);
    assert(Math.abs(gamma.evaluateInverse(gamma.evaluate(0.33)) - 0.33) < 1e-6);
  });
});
