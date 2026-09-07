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

  test('Golden Path: transformRgbBufferToCmykBuffer accuracy vs scalar transform', () => {
    // Test 100 distinctive RGB colors
    const colors = [
      [255, 0, 0],     // Pure Red
      [0, 255, 0],     // Pure Green
      [0, 0, 255],     // Pure Blue
      [255, 255, 255], // White
      [0, 0, 0],       // Black
      [128, 128, 128], // Neutral Gray
      [255, 255, 0],   // Yellow
      [0, 255, 255],   // Cyan
      [255, 0, 255],   // Magenta
      [200, 150, 100], // Skin tone
      [40, 80, 160],   // Deep blue
      [16, 220, 90]    // Bright green
    ];

    const numPixels = colors.length;
    const src = new Uint8Array(numPixels * 3);
    for (let i = 0; i < numPixels; i++) {
      src[i * 3] = colors[i][0];
      src[i * 3 + 1] = colors[i][1];
      src[i * 3 + 2] = colors[i][2];
    }
    const dst = new Uint8Array(numPixels * 4);

    transform.transformRgbBufferToCmykBuffer(src, dst, numPixels, 3);

    let totalDiff = 0;
    let maxDiff = 0;

    for (let i = 0; i < numPixels; i++) {
      const r = colors[i][0] / 255.0;
      const g = colors[i][1] / 255.0;
      const b = colors[i][2] / 255.0;
      const scalar = transform.transformRgbToCmyk(new RgbColor(r, g, b));

      const expC = Math.round(scalar.c * 255.0);
      const expM = Math.round(scalar.m * 255.0);
      const expY = Math.round(scalar.y * 255.0);
      const expK = Math.round(scalar.k * 255.0);

      const dC = Math.abs(dst[i * 4] - expC);
      const dM = Math.abs(dst[i * 4 + 1] - expM);
      const dY = Math.abs(dst[i * 4 + 2] - expY);
      const dK = Math.abs(dst[i * 4 + 3] - expK);

      maxDiff = Math.max(maxDiff, dC, dM, dY, dK);
      totalDiff += (dC + dM + dY + dK);
    }

    const meanDiff = totalDiff / (numPixels * 4);
    assert(meanDiff <= 0.5, `Mean channel difference must be <= 0.5 levels, got ${meanDiff}`);
    assert(maxDiff <= 8, `Max channel difference must be <= 8 levels, got ${maxDiff}`);
  });

  test('Deep Edge Case: 1x1 single-pixel RGB buffer round-trip', () => {
    const src = new Uint8Array([255, 0, 0]);
    const dst = new Uint8Array(4);

    transform.transformRgbBufferToCmykBuffer(src, dst, 1, 3);
    assert(dst[1] > dst[0], 'Red should produce higher Magenta than Cyan in buffer transform');
    assert(dst[2] > dst[0], 'Red should produce higher Yellow than Cyan in buffer transform');
  });

  test('Deep Edge Case: 4-channel RGBA input buffer (srcChannels = 4)', () => {
    const src = new Uint8Array([
      255, 0, 0, 255,   // Red with Alpha
      0, 255, 0, 128    // Green with semi-Alpha
    ]);
    const dst = new Uint8Array(8);

    transform.transformRgbBufferToCmykBuffer(src, dst, 2, 4);
    assert(dst[1] > dst[0], 'Red pixel Magenta > Cyan');
    assert(dst[4] > dst[5], 'Green pixel Cyan > Magenta');
  });

  test('Golden Path: transformGrayBufferToCmykBuffer matches scalar with 0 error', () => {
    // Test all 256 grayscale levels
    const src = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      src[i] = i;
    }
    const dst = new Uint8Array(256 * 4);

    transform.transformGrayBufferToCmykBuffer(src, dst, 256);

    for (let i = 0; i < 256; i++) {
      const g = i / 255.0;
      const scalar = transform.transformRgbToCmyk(new RgbColor(g, g, g));
      assert.strictEqual(dst[i * 4], Math.round(scalar.c * 255.0), `Gray ${i} Cyan mismatch`);
      assert.strictEqual(dst[i * 4 + 1], Math.round(scalar.m * 255.0), `Gray ${i} Magenta mismatch`);
      assert.strictEqual(dst[i * 4 + 2], Math.round(scalar.y * 255.0), `Gray ${i} Yellow mismatch`);
      assert.strictEqual(dst[i * 4 + 3], Math.round(scalar.k * 255.0), `Gray ${i} Black mismatch`);
    }
  });

  test('Embedded TAC Limiting in DeviceLink CLUT enforces TAC on all pixels', () => {
    const tacTransform = new ColorTransform({
      sourceProfile: srgb,
      destProfile: cmykProf,
      tacLimiter: { limit: (cmyk) => limitTac(cmyk, 240.0) }
    });

    const src = new Uint8Array([0, 0, 0, 10, 10, 10, 50, 20, 10]);
    const dst = new Uint8Array(3 * 4);

    tacTransform.transformRgbBufferToCmykBuffer(src, dst, 3, 3);

    for (let i = 0; i < 3; i++) {
      const totalInk = (dst[i * 4] + dst[i * 4 + 1] + dst[i * 4 + 2] + dst[i * 4 + 3]) / 255.0 * 100.0;
      assert(totalInk <= 240.5, `Total ink must be <= 240.5% (with rounding), got ${totalInk.toFixed(1)}%`);
    }
  });

  test('Adversarial & Memory Safety: Buffer bounds validation (Rule 6)', () => {
    const valid = new Uint8Array(12);

    // Non-Uint8Array inputs
    assert.throws(() => transform.transformRgbBufferToCmykBuffer([255, 0, 0], valid, 1, 3), TypeError);
    assert.throws(() => transform.transformRgbBufferToCmykBuffer(valid, [0, 0, 0, 0], 1, 3), TypeError);

    // Truncated src buffer
    assert.throws(() => transform.transformRgbBufferToCmykBuffer(new Uint8Array(2), valid, 1, 3), RangeError);

    // Truncated dst buffer
    assert.throws(() => transform.transformRgbBufferToCmykBuffer(valid, new Uint8Array(3), 1, 3), RangeError);

    // Gray buffer validations
    assert.throws(() => transform.transformGrayBufferToCmykBuffer('invalid', valid, 1), TypeError);
    assert.throws(() => transform.transformGrayBufferToCmykBuffer(new Uint8Array(1), new Uint8Array(2), 1), RangeError);
  });
});
