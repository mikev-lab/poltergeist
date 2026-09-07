/**
 * @file flattener.test.js
 * @description Unit tests for PDF/X-1a atomic region decomposition and TransparencyFlattener.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decomposeAtomicRegions } from '../../src/compositor/flattener/atomic_region.js';
import { TransparencyFlattener } from '../../src/compositor/flattener/transparency_flattener.js';
import { LayerRecord, LayeredImage, BlendMode } from '../../src/types/layer.js';
import { RasterImage, ColorSpaceType } from '../../src/types/image.js';

describe('AtomicRegion Decomposition & Transparency Flattener', () => {
  it('Decomposes overlapping layers into non-overlapping atomic rectangles with exact area preservation', () => {
    const canvasW = 100;
    const canvasH = 100;

    // Layer 1: [10, 10, 60, 60] with 50% opacity
    const layer1 = new LayerRecord({
      name: 'Layer 1',
      left: 10,
      top: 10,
      width: 50,
      height: 50,
      opacity: 0.5,
      visible: true
    });

    // Layer 2: [30, 30, 80, 80] with Multiply blend mode
    const layer2 = new LayerRecord({
      name: 'Layer 2',
      left: 30,
      top: 30,
      width: 50,
      height: 50,
      opacity: 1.0,
      blendMode: BlendMode.MULTIPLY,
      visible: true
    });

    const regions = decomposeAtomicRegions(canvasW, canvasH, [layer1, layer2]);
    assert.ok(regions.length > 1, 'Canvas must be decomposed into multiple atomic regions');

    // Verify all regions are within canvas bounds
    let totalArea = 0;
    for (const r of regions) {
      assert.ok(r.left >= 0 && r.right <= canvasW, 'Region within X bounds');
      assert.ok(r.top >= 0 && r.bottom <= canvasH, 'Region within Y bounds');
      assert.ok(r.width > 0 && r.height > 0, 'Region has positive dimensions');
      totalArea += r.width * r.height;
    }

    // Exact area conservation: sum of atomic regions MUST equal canvas area
    assert.strictEqual(totalArea, canvasW * canvasH, 'Total atomic region area matches canvas area exactly');

    // Overlapping region [30..60, 30..60] must have both layers and hasTransparency = true
    const overlapRegion = regions.find(r => r.left >= 30 && r.right <= 60 && r.top >= 30 && r.bottom <= 60);
    assert.ok(overlapRegion, 'Intersection region exists');
    assert.strictEqual(overlapRegion.hasTransparency, true);
    assert.strictEqual(overlapRegion.layers.length, 2);
  });

  it('TransparencyFlattener.flattenToRaster produces opaque unblended RasterImage', () => {
    const width = 4;
    const height = 4;

    const layer = new LayerRecord({
      name: 'Green 50%',
      left: 0,
      top: 0,
      width,
      height,
      opacity: 0.5,
      visible: true,
      image: new RasterImage({
        width,
        height,
        channels: 4,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.RGB,
        data: new Uint8Array(width * height * 4).fill(255)
      })
    });

    const layeredImage = new LayeredImage({
      width,
      height,
      colorSpace: ColorSpaceType.RGB,
      layers: [layer]
    });

    const flattened = TransparencyFlattener.flattenToRaster(layeredImage);
    assert.strictEqual(flattened.channels, 3, 'Output is 3-channel opaque RGB without alpha');
    assert.strictEqual(flattened.data.length, width * height * 3);
  });

  it('TransparencyFlattener.preflightCheck: Detects prohibited live transparency dictionaries', () => {
    // Certified compliant PDF/X-1a stream
    const compliantPdf = Buffer.from(
      '%PDF-1.3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n%%EOF'
    );
    const passResult = TransparencyFlattener.preflightCheck(compliantPdf);
    assert.strictEqual(passResult.compliant, true);
    assert.strictEqual(passResult.violations.length, 0);

    // Non-compliant PDF containing /S /Transparency and /SMask
    const illegalPdf = Buffer.from(
      '%PDF-1.4\n<< /Type /Page /Group << /S /Transparency >> /ExtGState << /GS1 << /SMask 5 0 R /ca 0.5 >> >> >>'
    );
    const failResult = TransparencyFlattener.preflightCheck(illegalPdf);
    assert.strictEqual(failResult.compliant, false);
    assert.ok(failResult.violations.length >= 2, 'Violations caught');
  });
});
