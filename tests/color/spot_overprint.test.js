import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SeparationColorSpace, DeviceNColorSpace, StandardSpotColors } from '../../src/color/spot/spot_color.js';
import { simulateOverprint, simulateSpotOverprint } from '../../src/color/overprint/overprint.js';
import { CmykColor } from '../../src/types/color.js';

describe('Spot Colors & Subtractive Overprint Simulation (-dSimulateOverprint)', () => {
  test('Spot Color: TintTransform evaluation at 100% and 50% tint', () => {
    const pantone185 = StandardSpotColors.PANTONE_185_C;
    assert.strictEqual(pantone185.name, 'PANTONE 185 C');

    // 100% tint
    const full = pantone185.evaluate(1.0);
    assert.strictEqual(full.m, 0.93);
    assert.strictEqual(full.y, 0.79);
    assert.strictEqual(full.k, 0.0);

    // 50% tint
    const half = pantone185.evaluate(0.5);
    assert.strictEqual(half.m, 0.93 * 0.5);
    assert.strictEqual(half.y, 0.79 * 0.5);
  });

  test('DeviceN: Evaluates multi-channel tint transform', () => {
    const devN = new DeviceNColorSpace(['Cyan', 'PANTONE 185 C'], 'DeviceCMYK', ([c, p]) => {
      return new CmykColor(c, p * 0.93, p * 0.79, 0);
    });

    const evaluated = devN.evaluate([0.8, 0.5]);
    assert.strictEqual(evaluated.c, 0.8);
    assert.strictEqual(evaluated.m, 0.5 * 0.93);
    assert.strictEqual(evaluated.y, 0.5 * 0.79);
  });

  test('Overprint Simulation: Knockout mode (OP=false) completely replaces background', () => {
    const bg = new CmykColor(1.0, 0.0, 0.0, 0.0); // 100% Cyan
    const fg = new CmykColor(0.0, 0.0, 0.0, 1.0); // 100% Black text
    const result = simulateOverprint(bg, fg, { overprint: false });
    assert.strictEqual(result.c, 0.0); // Cyan knocked out!
    assert.strictEqual(result.k, 1.0);
  });

  test('Overprint Simulation: OPM=1 mode preserves background non-zero channels', () => {
    const bg = new CmykColor(0.7, 0.2, 0.0, 0.0); // Cyan 70%, Magenta 20%
    const fg = new CmykColor(0.0, 0.0, 0.0, 1.0); // 100% Black overprint text
    const result = simulateOverprint(bg, fg, { overprint: true, overprintMode: 1 });

    // In OPM=1, foreground defines K=1, but C=0, M=0, Y=0.
    // Therefore background C=0.7 and M=0.2 print through!
    assert.strictEqual(result.c, 0.7);
    assert.strictEqual(result.m, 0.2);
    assert.strictEqual(result.y, 0.0);
    assert.strictEqual(result.k, 1.0);
  });

  test('Subtractive Spot Overprint: Simulates ink stacking density', () => {
    const bg = new CmykColor(0.5, 0.0, 0.0, 0.0); // 50% Cyan background
    const spot = new CmykColor(0.0, 0.8, 0.0, 0.0); // 80% Spot Magenta ink
    const result = simulateSpotOverprint(bg, spot);

    // Cyan is untouched by magenta
    assert.strictEqual(result.c, 0.5);
    // Magenta is laid down
    assert.strictEqual(result.m, 0.8);
  });
});
