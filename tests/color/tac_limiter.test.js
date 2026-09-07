import { test, describe } from 'node:test';
import assert from 'node:assert';
import { limitTac, PrepressTacLimits } from '../../src/color/tac/tac_limiter.js';
import { CmykColor } from '../../src/types/color.js';

describe('Prepress TAC (Total Area Coverage) Limiter & UCR/GCR Invariants', () => {
  test('Golden Path: In-limit CMYK colors remain completely untouched', () => {
    // 60 + 40 + 30 + 10 = 140% TAC (well below 300%)
    const inLimit = CmykColor.fromPercentages(60, 40, 30, 10);
    const result = limitTac(inLimit, PrepressTacLimits.SWOP_COATED);
    assert.strictEqual(result.c, inLimit.c);
    assert.strictEqual(result.m, inLimit.m);
    assert.strictEqual(result.y, inLimit.y);
    assert.strictEqual(result.k, inLimit.k);
    assert.strictEqual(result.tac, 140.0);
  });

  test('Boundary Edge Case: 400% maximum ink saturation is capped to SWOP 300%', () => {
    const max400 = new CmykColor(1.0, 1.0, 1.0, 1.0);
    const limited = limitTac(max400, PrepressTacLimits.SWOP_COATED);
    assert(
      limited.tac <= 300.0001,
      `Expected TAC <= 300%, got ${limited.tac}%`
    );
    assert(limited.k === 1.0, 'K plate should remain at 100% saturation');
    // C, M, Y should be reduced identically to preserve neutrality
    assert.strictEqual(limited.c, limited.m);
    assert.strictEqual(limited.m, limited.y);
  });

  test('Boundary Edge Case: 400% maximum ink saturation is capped to GRACoL 320%', () => {
    const max400 = new CmykColor(1.0, 1.0, 1.0, 1.0);
    const limited = limitTac(max400, PrepressTacLimits.GRACOL_COATED);
    assert(
      limited.tac <= 320.0001,
      `Expected TAC <= 320%, got ${limited.tac}%`
    );
    assert.strictEqual(limited.c, limited.m);
    assert.strictEqual(limited.m, limited.y);
  });

  test('Prepress Rich Black: GCR shifts chromatic ink to Black while maintaining neutrality', () => {
    // Rich black: C=80%, M=70%, Y=70%, K=90% = 310% TAC
    const richBlack = CmykColor.fromPercentages(80, 70, 70, 90);
    const limited = limitTac(richBlack, PrepressTacLimits.SWOP_COATED);
    assert(limited.tac <= 300.0001, `TAC exceeded: ${limited.tac}`);

    // Chromatic ratio preservation: M and Y were equal in source, must remain equal in output
    assert(
      Math.abs(limited.m - limited.y) < 1e-6,
      `Chromatic ratio violated: M=${limited.m}, Y=${limited.y}`
    );
  });

  test('Deep Chromatic Color: Hue angle ratio preservation', () => {
    // Deep saturated blue: C=100%, M=90%, Y=20%, K=100% = 310% TAC
    const deepBlue = CmykColor.fromPercentages(100, 90, 20, 100);
    const limited = limitTac(deepBlue, PrepressTacLimits.SWOP_COATED);
    assert(limited.tac <= 300.0001);

    // Initial chromatic ratio C/M = 100/90 = 1.111
    const initialRatio = deepBlue.c / deepBlue.m;
    const finalRatio = limited.c / limited.m;
    const ratioDelta = Math.abs(initialRatio - finalRatio) / initialRatio;
    assert(
      ratioDelta < 0.05,
      `Expected hue ratio preservation within 5%, delta was ${(ratioDelta * 100).toFixed(2)}%`
    );
  });

  test('Boundary Edge Cases: Zero ink and single channel inks', () => {
    const zero = new CmykColor(0, 0, 0, 0);
    const limitedZero = limitTac(zero, 300);
    assert.strictEqual(limitedZero.tac, 0.0);

    const pureC = new CmykColor(1.0, 0, 0, 0);
    const limitedC = limitTac(pureC, 300);
    assert.strictEqual(limitedC.c, 1.0);
    assert.strictEqual(limitedC.tac, 100.0);
  });
});
