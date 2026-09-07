/**
 * @file compositor.js
 * @description Multi-layer spread compositor with clipping masks and group opacity for Poltergeist.
 * Strictly zero-dependency and memory-safe.
 */

import { RasterImage, ColorSpaceType, PixelFormat } from '../../types/image.js';
import { blendWithAlpha } from './blend_modes.js';

export class MultiLayerCompositor {
  /**
   * Composites a LayeredImage into a single unified RasterImage.
   * @param {import('../../types/layer.js').LayeredImage} layeredImage 
   * @param {object} [options]
   * @param {boolean} [options.paperWhite=true] If true, background is solid white; if false, transparent
   * @returns {RasterImage}
   */
  static composite(layeredImage, options = {}) {
    const { width, height, dpiX, dpiY, colorSpace, layers } = layeredImage;
    const paperWhite = options.paperWhite !== false;

    const isCmyk = colorSpace === ColorSpaceType.CMYK;
    const channels = 4; // RGBA or CMYKA in intermediate float buffer

    const canvas = new Float64Array(width * height * channels);
    const canvasAlpha = new Float64Array(width * height);

    if (paperWhite) {
      if (isCmyk) {
        // Paper white in CMYK: C=0, M=0, Y=0, K=0, Alpha=1
        canvasAlpha.fill(1.0);
      } else {
        // Paper white in RGB: R=1, G=1, B=1, Alpha=1
        for (let i = 0; i < width * height; i++) {
          canvas[i * 4] = 1.0;
          canvas[i * 4 + 1] = 1.0;
          canvas[i * 4 + 2] = 1.0;
          canvas[i * 4 + 3] = 1.0;
        }
        canvasAlpha.fill(1.0);
      }
    }

    // Keep track of base layer alpha for clipping masks
    let lastBaseAlpha = null;

    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l];
      if (!layer.visible || layer.isFolder || !layer.image) {
        continue;
      }

      const lImg = layer.image;
      const lWidth = lImg.width;
      const lHeight = lImg.height;
      const lData = lImg.data;
      const lChannels = lImg.channels;
      const hasAlpha = lImg.hasAlpha || lChannels === 4;

      const layerOpacity = layer.opacity;
      const blendMode = layer.blendMode;

      // Update base layer alpha tracker if not clipping
      if (!layer.clipping) {
        lastBaseAlpha = new Float64Array(width * height);
      }

      for (let ly = 0; ly < lHeight; ly++) {
        const cy = layer.top + ly;
        if (cy < 0 || cy >= height) continue;

        const canvasRowOffset = cy * width;

        for (let lx = 0; lx < lWidth; lx++) {
          const cx = layer.left + lx;
          if (cx < 0 || cx >= width) continue;

          const canvasIdx = (canvasRowOffset + cx) * 4;
          const alphaIdx = canvasRowOffset + cx;

          const lPixelIdx = (ly * lWidth + lx) * lChannels;

          let s0 = lData[lPixelIdx] / 255.0;
          let s1 = lData[lPixelIdx + 1] / 255.0;
          let s2 = lData[lPixelIdx + 2] / 255.0;
          let s3 = (hasAlpha ? lData[lPixelIdx + (lChannels - 1)] : 255) / 255.0;
          let srcAlpha = s3 * layerOpacity;

          // Mask handling
          if (layer.mask) {
            const maskIdx = ly * lWidth + lx;
            if (maskIdx < layer.mask.length) {
              srcAlpha *= layer.mask[maskIdx] / 255.0;
            }
          }

          // Clipping mask: modulated by base layer alpha
          if (layer.clipping && lastBaseAlpha) {
            srcAlpha *= lastBaseAlpha[alphaIdx];
          } else if (!layer.clipping && lastBaseAlpha) {
            lastBaseAlpha[alphaIdx] = srcAlpha;
          }

          if (srcAlpha <= 0) continue;

          const b0 = canvas[canvasIdx];
          const b1 = canvas[canvasIdx + 1];
          const b2 = canvas[canvasIdx + 2];
          const bAlpha = canvasAlpha[alphaIdx];

          const res0 = blendWithAlpha(blendMode, b0, bAlpha, s0, srcAlpha);
          const res1 = blendWithAlpha(blendMode, b1, bAlpha, s1, srcAlpha);
          const res2 = blendWithAlpha(blendMode, b2, bAlpha, s2, srcAlpha);

          canvas[canvasIdx] = res0.color;
          canvas[canvasIdx + 1] = res1.color;
          canvas[canvasIdx + 2] = res2.color;

          if (isCmyk) {
            let sK = lData[lPixelIdx + 3] / 255.0;
            const bK = canvas[canvasIdx + 3];
            const resK = blendWithAlpha(blendMode, bK, bAlpha, sK, srcAlpha);
            canvas[canvasIdx + 3] = resK.color;
          }

          canvasAlpha[alphaIdx] = res0.alpha;
        }
      }
    }

    // Convert canvas Float64Array to Uint8Array output
    const outputAlpha = options.outputAlpha !== false;
    const outChannels = isCmyk ? 4 : (outputAlpha ? 4 : 3);
    const outData = new Uint8Array(width * height * outChannels);

    for (let i = 0; i < width * height; i++) {
      outData[i * outChannels] = Math.round(canvas[i * 4] * 255.0);
      outData[i * outChannels + 1] = Math.round(canvas[i * 4 + 1] * 255.0);
      outData[i * outChannels + 2] = Math.round(canvas[i * 4 + 2] * 255.0);
      if (isCmyk) {
        outData[i * outChannels + 3] = Math.round(canvas[i * 4 + 3] * 255.0);
      } else if (outputAlpha) {
        outData[i * outChannels + 3] = Math.round(canvasAlpha[i] * 255.0);
      }
    }

    return new RasterImage({
      width,
      height,
      channels: outChannels,
      bitsPerSample: 8,
      colorSpace,
      pixelFormat: isCmyk ? PixelFormat.CMYK32 : (outputAlpha ? PixelFormat.RGBA32 : PixelFormat.RGB24),
      dpiX,
      dpiY,
      data: outData,
      iccProfile: layeredImage.iccProfile,
      hasAlpha: !isCmyk && outputAlpha
    });
  }
}
