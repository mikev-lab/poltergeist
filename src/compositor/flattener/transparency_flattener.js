/**
 * @file transparency_flattener.js
 * @description Prepress transparency flattener for PDF/X-1a and commercial print production.
 * Decomposes overlapping transparent layers into atomic regions, rasterizing contone blend groups
 * into opaque CMYK/RGB sub-tiles to eliminate all live transparency.
 * Zero-dependency, memory-safe.
 */

import { decomposeAtomicRegions } from './atomic_region.js';
import { MultiLayerCompositor } from '../blend/compositor.js';
import { RasterImage } from '../../types/image.js';

export class TransparencyFlattener {
  /**
   * Flattens a LayeredImage into a completely opaque RasterImage with zero live transparency.
   * Renders background to solid paper-white (100% white or DeviceCMYK 0,0,0,0) and composites all layers.
   * 
   * @param {import('../../types/layer.js').LayeredImage} layeredImage
   * @param {object} [options]
   * @param {number[]} [options.paperWhite] Solid background fill (defaults to RGB [255, 255, 255])
   * @param {string} [options.targetColorSpace] 'RGB' | 'CMYK' (defaults to RGB or image color space)
   * @returns {RasterImage} 100% opaque RasterImage without alpha
   */
  static flattenToRaster(layeredImage, options = {}) {
    if (!layeredImage) {
      throw new Error('TransparencyFlattener: layeredImage is required.');
    }

    const colorSpace = options.targetColorSpace || layeredImage.colorSpace || 'RGB';
    const isCmyk = colorSpace === 'CMYK';
    const channels = isCmyk ? 4 : 3;

    // Paper white: RGB = [255, 255, 255], CMYK = [0, 0, 0, 0] (0% ink)
    const paperWhite = options.paperWhite || (isCmyk ? [0, 0, 0, 0] : [255, 255, 255]);

    // Use MultiLayerCompositor to composite all layers onto paper-white backing
    const composited = MultiLayerCompositor.composite(layeredImage, {
      backgroundColor: paperWhite,
      outputAlpha: false
    });

    return composited;
  }

  /**
   * Decomposes a LayeredImage into atomic regions and rasterizes transparent regions into sub-tiles.
   * Regions without transparency can remain vector or direct unblended tiles.
   * 
   * @param {import('../../types/layer.js').LayeredImage} layeredImage
   * @param {object} [options]
   * @returns {{
   *   regions: Array<import('./atomic_region.js').AtomicRegion>,
   *   subTiles: Array<{ region: import('./atomic_region.js').AtomicRegion, image: RasterImage }>
   * }}
   */
  static flattenAtomicRegions(layeredImage, options = {}) {
    if (!layeredImage) {
      throw new Error('TransparencyFlattener: layeredImage is required.');
    }

    const { width, height, layers } = layeredImage;
    const regions = decomposeAtomicRegions(width, height, layers);

    /** @type {Array<{ region: import('./atomic_region.js').AtomicRegion, image: RasterImage }>} */
    const subTiles = [];

    for (const region of regions) {
      if (region.hasTransparency) {
        // Create a sub-layered image for this region
        const subLayers = region.layers.map(layer => {
          // Crop layer to region bounds
          return layer.crop(region.left, region.top, region.width, region.height);
        });

        const subLayeredImage = {
          width: region.width,
          height: region.height,
          resolution: layeredImage.resolution,
          colorSpace: layeredImage.colorSpace,
          layers: subLayers,
          compositeImage: null
        };

        const rasterTile = MultiLayerCompositor.composite(subLayeredImage, {
          backgroundColor: options.paperWhite || [255, 255, 255],
          outputAlpha: false
        });

        subTiles.push({ region, image: rasterTile });
      }
    }

    return { regions, subTiles };
  }

  /**
   * Asserts that a generated PDF buffer contains zero prohibited live transparency dictionaries.
   * Required for PDF/X-1a compliance preflight check.
   * 
   * @param {Uint8Array|Buffer} pdfBuffer
   * @returns {{ compliant: boolean, violations: string[] }}
   */
  static preflightCheck(pdfBuffer) {
    const bytes = pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer);
    const pdfText = new TextDecoder('latin1').decode(bytes);
    const violations = [];

    // PDF/X-1a prohibit checks:
    // 1. Live transparency group: /S /Transparency
    if (/\/S\s*\/Transparency\b/.test(pdfText)) {
      violations.push('Prohibited transparency group (/S /Transparency) found.');
    }

    // 2. Soft masks: /SMask
    if (/\/SMask\b/.test(pdfText) && !/\/SMask\s*\/None\b/.test(pdfText)) {
      violations.push('Prohibited soft mask (/SMask) found in graphic state.');
    }

    // 3. Prohibited blend modes (anything other than /Normal or /Compatible)
    const blendModeMatch = pdfText.match(/\/BM\s*\/([A-Za-z]+)/g);
    if (blendModeMatch) {
      for (const bm of blendModeMatch) {
        if (!/\/BM\s*\/(Normal|Compatible)\b/.test(bm)) {
          violations.push(`Prohibited live blend mode (${bm.trim()}) found.`);
        }
      }
    }

    // 4. Constant opacity < 1.0 (/CA or /ca)
    const caMatches = pdfText.match(/\/(CA|ca)\s+([0-9.]+)/g);
    if (caMatches) {
      for (const m of caMatches) {
        const parts = m.trim().split(/\s+/);
        const val = parseFloat(parts[1]);
        if (!isNaN(val) && val < 0.999) {
          violations.push(`Prohibited non-unity constant opacity (${m.trim()}) found.`);
        }
      }
    }

    return {
      compliant: violations.length === 0,
      violations
    };
  }
}
