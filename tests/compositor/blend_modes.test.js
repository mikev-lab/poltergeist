/**
 * @file blend_modes.test.js
 * @description Comprehensive tests for Porter-Duff alpha compositing, separable blend modes, and MultiLayerCompositor.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compositeSourceOver, CompositeOperator } from '../../src/compositor/blend/porter_duff.js';
import { blendChannel, blendWithAlpha, PrepressBlendMode } from '../../src/compositor/blend/blend_modes.js';
import { MultiLayerCompositor } from '../../src/compositor/blend/compositor.js';
import { LayerRecord, LayeredImage, BlendMode } from '../../src/types/layer.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../src/types/image.js';

describe('Porter-Duff Alpha Compositing & Prepress Blend Modes', () => {
  it('Porter-Duff: Source Over math with 100% and 50% alpha', () => {
    // Both 100% opaque: Source replaces Backdrop
    const { color: c1, alpha: a1 } = compositeSourceOver(0.8, 1.0, 0.2, 1.0);
    assert.strictEqual(a1, 1.0);
    assert.strictEqual(c1, 0.8);

    // 50% Source over 100% Backdrop
    const { color: c2, alpha: a2 } = compositeSourceOver(1.0, 0.5, 0.0, 1.0);
    assert.strictEqual(a2, 1.0);
    assert.ok(Math.abs(c2 - 0.5) < 1e-4);

    // 50% Source over 50% Backdrop: alpha_r = 0.5 + 0.5*(1 - 0.5) = 0.75
    const { color: c3, alpha: a3 } = compositeSourceOver(1.0, 0.5, 0.0, 0.5);
    assert.strictEqual(a3, 0.75);
    // c_r = (1.0*0.5 + 0.0*0.5*0.5) / 0.75 = 0.5 / 0.75 = 2/3
    assert.ok(Math.abs(c3 - 2/3) < 1e-4);
  });

  it('Blend Modes: Mathematical accuracy of separable equations', () => {
    // Multiply: Cb * Cs
    const mul = blendChannel(PrepressBlendMode.MULTIPLY, 0.5, 0.5);
    assert.ok(Math.abs(mul - 0.25) < 1e-5);

    // Screen: 1 - (1 - Cb)*(1 - Cs) -> 1 - 0.5*0.5 = 0.75
    const scr = blendChannel(PrepressBlendMode.SCREEN, 0.5, 0.5);
    assert.ok(Math.abs(scr - 0.75) < 1e-5);

    // Darken: min(Cb, Cs)
    const drk = blendChannel(PrepressBlendMode.DARKEN, 0.3, 0.7);
    assert.strictEqual(drk, 0.3);

    // Lighten: max(Cb, Cs)
    const lgt = blendChannel(PrepressBlendMode.LIGHTEN, 0.3, 0.7);
    assert.strictEqual(lgt, 0.7);

    // Difference: abs(Cb - Cs)
    const diff = blendChannel(PrepressBlendMode.DIFFERENCE, 0.8, 0.3);
    assert.ok(Math.abs(diff - 0.5) < 1e-5);

    // Exclusion: Cb + Cs - 2*Cb*Cs -> 0.5 + 0.5 - 2*0.25 = 0.5
    const excl = blendChannel(PrepressBlendMode.EXCLUSION, 0.5, 0.5);
    assert.ok(Math.abs(excl - 0.5) < 1e-5);

    // Overlay (Cb <= 0.5: 2*Cb*Cs)
    const overLow = blendChannel(PrepressBlendMode.OVERLAY, 0.25, 0.5);
    assert.ok(Math.abs(overLow - 0.25) < 1e-5);

    // Soft Light (W3C SVG formula)
    const softLight = blendChannel(PrepressBlendMode.SOFT_LIGHT, 0.5, 0.5);
    assert.ok(Math.abs(softLight - 0.5) < 1e-4);
  });

  it('blendWithAlpha: Evaluates ISO 32000 alpha-weighted blend formula', () => {
    // 50% opacity multiply layer (gray 0.5) over white (1.0)
    // alpha_r = 1.0
    // C_r = (1 - 1)*0.5*0.5 + (1 - 0.5)*1.0*1.0 + 0.5*1.0*(0.5*1.0) = 0 + 0.5 + 0.25 = 0.75
    const { color: c, alpha: a } = blendWithAlpha(PrepressBlendMode.MULTIPLY, 1.0, 1.0, 0.5, 0.5);
    assert.strictEqual(a, 1.0);
    assert.ok(Math.abs(c - 0.75) < 1e-4);
  });
});

describe('MultiLayerCompositor: Multi-layer Spreads, Blending & Clipping', () => {
  it('Composites 2 overlapping layers (Red over Blue with 50% opacity)', () => {
    const width = 2;
    const height = 2;

    // Bottom layer: Blue (0, 0, 255, 255)
    const blueData = new Uint8Array([
      0, 0, 255, 255,   0, 0, 255, 255,
      0, 0, 255, 255,   0, 0, 255, 255
    ]);
    const bottomLayer = new LayerRecord({
      name: 'Blue Base',
      left: 0,
      top: 0,
      width,
      height,
      opacity: 1.0,
      visible: true,
      image: new RasterImage({
        width,
        height,
        channels: 4,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.RGB,
        data: blueData
      })
    });

    // Top layer: Red (255, 0, 0, 255) with 50% opacity
    const redData = new Uint8Array([
      255, 0, 0, 255,   255, 0, 0, 255,
      255, 0, 0, 255,   255, 0, 0, 255
    ]);
    const topLayer = new LayerRecord({
      name: 'Red 50%',
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
        data: redData
      })
    });

    const layeredImage = new LayeredImage({
      width,
      height,
      colorSpace: ColorSpaceType.RGB,
      layers: [bottomLayer, topLayer]
    });

    const result = MultiLayerCompositor.composite(layeredImage, { outputAlpha: false });
    assert.strictEqual(result.width, 2);
    assert.strictEqual(result.height, 2);
    assert.strictEqual(result.channels, 3); // Opaque RGB output

    // 50% Red (255) + 50% Blue (255) = ~128 Red, 0 Green, ~128 Blue
    const r = result.data[0];
    const g = result.data[1];
    const b = result.data[2];
    assert.ok(Math.abs(r - 128) <= 2, `Expected R ~128, got ${r}`);
    assert.strictEqual(g, 0);
    assert.ok(Math.abs(b - 128) <= 2, `Expected B ~128, got ${b}`);
  });

  it('Clipping Mask: Clipped layer is only visible within base layer alpha', () => {
    const width = 2;
    const height = 1;

    // Base layer: Left pixel opaque (alpha=255), Right pixel transparent (alpha=0)
    const baseData = new Uint8Array([
      0, 255, 0, 255,   // Left: Green opaque
      0, 255, 0, 0     // Right: fully transparent
    ]);
    const baseLayer = new LayerRecord({
      name: 'Mask Base',
      left: 0,
      top: 0,
      width,
      height,
      opacity: 1.0,
      clipping: false,
      visible: true,
      image: new RasterImage({
        width,
        height,
        channels: 4,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.RGB,
        data: baseData
      })
    });

    // Clipped layer: Red across entire width (both pixels opaque 255)
    const clippedData = new Uint8Array([
      255, 0, 0, 255,   // Left: Red
      255, 0, 0, 255    // Right: Red
    ]);
    const clippedLayer = new LayerRecord({
      name: 'Clipped Red',
      left: 0,
      top: 0,
      width,
      height,
      opacity: 1.0,
      clipping: true,
      visible: true,
      image: new RasterImage({
        width,
        height,
        channels: 4,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.RGB,
        data: clippedData
      })
    });

    const layeredImage = new LayeredImage({
      width,
      height,
      colorSpace: ColorSpaceType.RGB,
      layers: [baseLayer, clippedLayer]
    });

    // Composite onto solid white background [255, 255, 255]
    const result = MultiLayerCompositor.composite(layeredImage, {
      backgroundColor: [255, 255, 255],
      outputAlpha: false
    });

    // Left pixel: clipped Red completely replaces base Green -> Red (255, 0, 0)
    assert.strictEqual(result.data[0], 255);
    assert.strictEqual(result.data[1], 0);
    assert.strictEqual(result.data[2], 0);

    // Right pixel: base layer was transparent (alpha=0), so clipped layer is masked out!
    // Result should be background white (255, 255, 255)
    assert.strictEqual(result.data[3], 255);
    assert.strictEqual(result.data[4], 255);
    assert.strictEqual(result.data[5], 255);
  });
});
