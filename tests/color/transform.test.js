import { test, describe } from 'node:test';
import assert from 'node:assert';
import { IccProfile } from '../../src/color/icc/profile.js';
import { ColorTransform } from '../../src/color/transform/transform.js';
import { RgbColor, CmykColor, LabColor } from '../../src/types/color.js';
import { ciede2000 } from '../../src/color/metrics/ciede2000.js';
import { limitTac, PrepressTacLimits } from '../../src/color/tac/tac_limiter.js';

describe('ColorTransform Pipeline: RGB to Prepress CMYK Separation', () => {
  const srgb = IccProfile.createSrgbProfile();
  const cmykProf = IccProfile.createCmykReferenceProfile();
  const transform = new ColorTransform(srgb, cmykProf);

  test('White point conversion: RGB (1,1,1) maps to clean Paper White (C=0, M=0, Y=0, K=0)', () => {
    const white = new RgbColor(1.0, 1.0, 1.0);
    const cmyk = transform.transformRgbToCmyk(white);
    assert(cmyk.c < 0.05, `Expected Cyan < 5%, got ${cmyk.c}`);
    assert(cmyk.m < 0.05, `Expected Magenta < 5%, got ${cmyk.m}`);
    assert(cmyk.y < 0.05, `Expected Yellow < 5%, got ${cmyk.y}`);
    assert(cmyk.k < 0.05, `Expected Black < 5%, got ${cmyk.k}`);
  });

  test('Black point conversion: RGB (0,0,0) maps to solid black', () => {
    const black = new RgbColor(0.0, 0.0, 0.0);
    const cmyk = transform.transformRgbToCmyk(black);
    assert(cmyk.k >= 0.8, `Expected Black >= 80%, got ${cmyk.k}`);
  });

  test('Prepress Separation + TAC limiting integration', () => {
    // Saturated red RGB (1, 0, 0)
    const red = new RgbColor(1.0, 0.0, 0.0);
    const rawCmyk = transform.transformRgbToCmyk(red);

    // Assert red produces predominantly Magenta and Yellow
    assert(rawCmyk.m > rawCmyk.c, 'Red should produce more Magenta than Cyan');
    assert(rawCmyk.y > rawCmyk.c, 'Red should produce more Yellow than Cyan');

    // Apply TAC limit
    const limited = limitTac(rawCmyk, PrepressTacLimits.SWOP_COATED);
    assert(limited.tac <= 300.0, `TAC must be <= 300%, got ${limited.tac}%`);
  });

  test('PCS Round-trip validation via CIEDE2000', () => {
    // Test mid-gray RGB (0.5, 0.5, 0.5)
    const midGray = new RgbColor(0.5, 0.5, 0.5);
    const cmyk = transform.transformRgbToCmyk(midGray);
    const reconstructedLab = transform.transformCmykToLab(cmyk);

    // Target mid-gray in Lab: L* ~ 53.4, a* ~ 0, b* ~ 0
    const expectedLab = new LabColor(53.4, 0.0, 0.0);
    const de = ciede2000(reconstructedLab, expectedLab);

    // Invariant: CIEDE2000 color difference is bounded and acceptable
    assert(
      de < 5.0,
      `Delta E 00 deviation for mid-gray should be bounded, got ${de.toFixed(2)}`
    );
  });
});
