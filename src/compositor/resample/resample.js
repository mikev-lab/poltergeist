/**
 * @file resample.js
 * @description 2D separable image resampling engine and prepress downsampler for Poltergeist.
 * Strictly zero-dependency, memory-safe, supports Bicubic and Lanczos-3 with anti-aliasing.
 */

import { RasterImage } from '../../types/image.js';
import { resolveFilter, Lanczos3Filter, BicubicCatmullRomFilter } from './filters.js';

/**
 * Computes convolution filter weights and sample bounds for a 1D dimension.
 * @param {number} srcSize 
 * @param {number} destSize 
 * @param {import('./filters.js').FilterKernel} kernel 
 * @returns {Array<{ left: number, right: number, weights: Float64Array }>}
 */
function computeWeights(srcSize, destSize, kernel) {
  const scale = destSize / srcSize;
  const isDownsampling = scale < 1.0;
  const filterScale = isDownsampling ? scale : 1.0;
  const filterRadius = isDownsampling ? kernel.radius / scale : kernel.radius;

  const contributions = new Array(destSize);

  for (let d = 0; d < destSize; d++) {
    const center = (d + 0.5) / scale - 0.5;
    const left = Math.max(0, Math.floor(center - filterRadius));
    const right = Math.min(srcSize - 1, Math.ceil(center + filterRadius));
    const count = Math.max(1, right - left + 1);

    const weights = new Float64Array(count);
    let totalWeight = 0;

    for (let s = left; s <= right; s++) {
      const dist = (s - center) * filterScale;
      const weight = kernel.fn(dist) * filterScale;
      weights[s - left] = weight;
      totalWeight += weight;
    }

    // Normalize weights to sum to 1.0
    if (totalWeight !== 0) {
      const invTotal = 1.0 / totalWeight;
      for (let i = 0; i < count; i++) {
        weights[i] *= invTotal;
      }
    } else {
      weights[0] = 1.0;
    }

    contributions[d] = { left, right, weights };
  }

  return contributions;
}

/**
 * Resamples a RasterImage to specified target width and height.
 * @param {RasterImage} image 
 * @param {number} targetWidth 
 * @param {number} targetHeight 
 * @param {object} [options]
 * @param {string|import('./filters.js').FilterKernel} [options.filter=Lanczos3Filter]
 * @returns {RasterImage}
 */
export function resample(image, targetWidth, targetHeight, options = {}) {
  if (!Number.isInteger(targetWidth) || targetWidth <= 0) {
    throw new RangeError(`Target width must be a positive integer, got ${targetWidth}`);
  }
  if (!Number.isInteger(targetHeight) || targetHeight <= 0) {
    throw new RangeError(`Target height must be a positive integer, got ${targetHeight}`);
  }

  if (image.width === targetWidth && image.height === targetHeight) {
    return image;
  }

  const kernel = resolveFilter(options.filter || Lanczos3Filter);
  const { width: srcW, height: srcH, channels, bytesPerSample, bitsPerSample, data: srcData } = image;
  const maxVal = bitsPerSample === 16 ? 65535 : 255;

  // Horizontal weights: srcW -> targetWidth
  const hWeights = computeWeights(srcW, targetWidth, kernel);

  // Pass 1: Horizontal Resampling (srcW x srcH -> targetWidth x srcH)
  // Store intermediate samples as Float64 to avoid rounding loss
  const intermediate = new Float64Array(targetWidth * srcH * channels);

  for (let y = 0; y < srcH; y++) {
    const srcRowOffset = y * srcW * channels;
    const interRowOffset = y * targetWidth * channels;

    for (let x = 0; x < targetWidth; x++) {
      const { left, weights } = hWeights[x];
      const interOffset = interRowOffset + x * channels;

      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let i = 0; i < weights.length; i++) {
          const srcIdx = srcRowOffset + (left + i) * channels + c;
          let val;
          if (bytesPerSample === 1) {
            val = srcData[srcIdx];
          } else {
            val = (srcData[srcIdx * 2] << 8) | srcData[srcIdx * 2 + 1];
          }
          sum += val * weights[i];
        }
        intermediate[interOffset + c] = sum;
      }
    }
  }

  // Vertical weights: srcH -> targetHeight
  const vWeights = computeWeights(srcH, targetHeight, kernel);

  // Pass 2: Vertical Resampling (targetWidth x srcH -> targetWidth x targetHeight)
  const outData = new Uint8Array(targetWidth * targetHeight * channels * bytesPerSample);

  for (let y = 0; y < targetHeight; y++) {
    const { left, weights } = vWeights[y];
    const outRowOffset = y * targetWidth * channels;

    for (let x = 0; x < targetWidth; x++) {
      const outPixelOffset = outRowOffset + x * channels;

      for (let c = 0; c < channels; c++) {
        let sum = 0;
        for (let i = 0; i < weights.length; i++) {
          const interIdx = (left + i) * targetWidth * channels + x * channels + c;
          sum += intermediate[interIdx] * weights[i];
        }

        // Clamp to valid range
        const clamped = sum < 0 ? 0 : sum > maxVal ? maxVal : Math.round(sum);

        if (bytesPerSample === 1) {
          outData[outPixelOffset + c] = clamped;
        } else {
          const byteIdx = (outPixelOffset + c) * 2;
          outData[byteIdx] = (clamped >> 8) & 0xff;
          outData[byteIdx + 1] = clamped & 0xff;
        }
      }
    }
  }

  // Compute scaled DPI
  const scaleX = targetWidth / srcW;
  const scaleY = targetHeight / srcH;
  const newDpiX = Math.round(image.dpiX * scaleX);
  const newDpiY = Math.round(image.dpiY * scaleY);

  return new RasterImage({
    width: targetWidth,
    height: targetHeight,
    channels: image.channels,
    bitsPerSample: image.bitsPerSample,
    colorSpace: image.colorSpace,
    pixelFormat: image.pixelFormat,
    dpiX: newDpiX > 0 ? newDpiX : 300,
    dpiY: newDpiY > 0 ? newDpiY : 300,
    data: outData,
    iccProfile: image.iccProfile,
    spotNames: image.spotNames,
    hasAlpha: image.hasAlpha
  });
}

/**
 * Prepress image downsampler: downsamples images placed at > 450 DPI to standard 300 DPI.
 * @param {RasterImage} image 
 * @param {object} [options]
 * @param {number} [options.thresholdDpi=450] Prepress threshold DPI triggering downsampling
 * @param {number} [options.targetDpi=300] Standard target print DPI
 * @param {string|import('./filters.js').FilterKernel} [options.filter=Lanczos3Filter]
 * @returns {RasterImage}
 */
export function downsampleForPrepress(image, options = {}) {
  const thresholdDpi = options.thresholdDpi || 450;
  const targetDpi = options.targetDpi || 300;
  const filter = options.filter || Lanczos3Filter;

  if (image.dpiX <= thresholdDpi && image.dpiY <= thresholdDpi) {
    return image; // Within acceptable prepress resolution, preserve original pixels
  }

  const scaleX = targetDpi / image.dpiX;
  const scaleY = targetDpi / image.dpiY;

  const targetWidth = Math.max(1, Math.round(image.width * scaleX));
  const targetHeight = Math.max(1, Math.round(image.height * scaleY));

  const resampled = resample(image, targetWidth, targetHeight, { filter });

  // Explicitly assign target print DPI
  return new RasterImage({
    width: resampled.width,
    height: resampled.height,
    channels: resampled.channels,
    bitsPerSample: resampled.bitsPerSample,
    colorSpace: resampled.colorSpace,
    pixelFormat: resampled.pixelFormat,
    dpiX: targetDpi,
    dpiY: targetDpi,
    data: resampled.data,
    iccProfile: resampled.iccProfile,
    spotNames: resampled.spotNames,
    hasAlpha: resampled.hasAlpha
  });
}
