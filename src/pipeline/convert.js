/**
 * @file convert.js
 * @description Unified "Provide X, Get X" conversion pipeline orchestrator for Poltergeist.
 * Zero-dependency, stream-lined raster-to-prepress transformation.
 */

import { decodeRaster } from '../ingestion/raster/index.js';
import { decodeLayered } from '../ingestion/layered/index.js';
import { isDocumentFormat, decodeDocument } from '../ingestion/document/index.js';
import { DocumentStream } from '../compositor/assembly/document_stream.js';
import { TransparencyFlattener } from '../compositor/flattener/transparency_flattener.js';
import { downsampleForPrepress, resample } from '../compositor/resample/resample.js';
import { ColorTransform } from '../color/transform/transform.js';
import { IccProfile } from '../color/icc/profile.js';
import { TacLimiter } from '../color/tac/tac_limiter.js';
import { RgbColor, CmykColor } from '../types/color.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../types/image.js';
import { LayeredImage } from '../types/layer.js';
import { Document, PageRecord } from '../types/document.js';
import { PdfX1aGenerator } from '../export/pdf/pdfx1a.js';
import { PdfX4Generator } from '../export/pdf/pdfx4.js';
import { TiffWriter } from '../export/tiff/tiff_writer.js';
import { SeparationPlateGenerator } from '../export/tiffsep/plate_generator.js';

export const ExportFormat = Object.freeze({
  PDF_X1A: 'pdf/x-1a',
  PDF_X4: 'pdf/x-4',
  TIFF: 'tiff',
  TIFFSEP: 'tiffsep'
});

/**
 * Converts a RasterImage from RGB/Gray to CMYK with TAC limiting.
 * @param {RasterImage} image
 * @param {object} options
 * @param {number} tacMax
 * @returns {RasterImage}
 */
function convertImageToCmyk(image, options, tacMax) {
  if (image.colorSpace === ColorSpaceType.CMYK) {
    return image;
  }

  const srcProfile = image.iccProfile || IccProfile.createSrgbProfile();
  const destProfile = options.targetIccProfile || IccProfile.createCmykReferenceProfile();

  const transform = new ColorTransform({
    sourceProfile: srcProfile,
    destinationProfile: destProfile,
    tacLimiter: new TacLimiter({ maxTac: tacMax })
  });

  const { width, height, data } = image;
  const numPixels = width * height;
  const cmykData = new Uint8Array(numPixels * 4);

  if (image.colorSpace === ColorSpaceType.RGB) {
    for (let i = 0; i < numPixels; i++) {
      const r = data[i * image.channels] / 255.0;
      const g = data[i * image.channels + 1] / 255.0;
      const b = data[i * image.channels + 2] / 255.0;

      const cmyk = transform.transform(new RgbColor(r, g, b));
      cmykData[i * 4] = Math.round(cmyk.c * 255.0);
      cmykData[i * 4 + 1] = Math.round(cmyk.m * 255.0);
      cmykData[i * 4 + 2] = Math.round(cmyk.y * 255.0);
      cmykData[i * 4 + 3] = Math.round(cmyk.k * 255.0);
    }
  } else if (image.colorSpace === ColorSpaceType.GRAY) {
    for (let i = 0; i < numPixels; i++) {
      const gray = data[i] / 255.0;
      const cmyk = transform.transform(new RgbColor(gray, gray, gray));
      cmykData[i * 4] = Math.round(cmyk.c * 255.0);
      cmykData[i * 4 + 1] = Math.round(cmyk.m * 255.0);
      cmykData[i * 4 + 2] = Math.round(cmyk.y * 255.0);
      cmykData[i * 4 + 3] = Math.round(cmyk.k * 255.0);
    }
  }

  return new RasterImage({
    width,
    height,
    channels: 4,
    bitsPerSample: 8,
    colorSpace: ColorSpaceType.CMYK,
    pixelFormat: PixelFormat.CMYK32,
    dpiX: image.dpiX,
    dpiY: image.dpiY,
    data: cmykData,
    iccProfile: destProfile,
    spotNames: image.spotNames
  });
}

/**
 * High-speed prepress conversion orchestrator.
 * Supports raster, layered formats, and multi-page document layouts (PDF, IDML, OpenXML, ODF, iWork, XPS, PS).
 * @param {Uint8Array|Buffer|Document} input 
 * @param {object} [options]
 * @param {string} [options.targetFormat=ExportFormat.PDF_X1A]
 * @param {boolean} [options.downsample=true] Apply prepress threshold downsampling (>450 DPI -> 300 DPI)
 * @param {number} [options.targetDpi=300] Target print resolution
 * @param {number} [options.tacMax=300] Total Area Coverage ink limit (300% SWOP, 320% GRACoL)
 * @param {import('../color/icc/profile.js').IccProfile} [options.targetIccProfile]
 * @param {string} [options.jobName='job']
 * @returns {Uint8Array|Map<string, Uint8Array>}
 */
export function convert(input, options = {}) {
  const targetFormat = options.targetFormat || ExportFormat.PDF_X1A;
  const shouldDownsample = options.downsample !== false;
  const targetDpi = options.targetDpi || 300;
  const tacMax = options.tacMax || 300;
  const requiresCmyk = targetFormat === ExportFormat.PDF_X1A || targetFormat === ExportFormat.TIFFSEP;

  // 1. Ingest: Sniff Document vs Layered vs Raster
  let document = null;
  let image = null;

  if (input instanceof Document) {
    document = input;
  } else {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

    if (isDocumentFormat(bytes)) {
      document = decodeDocument(bytes, options);
    } else {
      const isPsd = bytes.length >= 4 && bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53;
      const isClip = bytes.length >= 16 && bytes[0] === 0x53 && bytes[1] === 0x51 && bytes[2] === 0x4c && bytes[3] === 0x69;
      const isXcf = bytes.length >= 9 && bytes[0] === 0x67 && bytes[1] === 0x69 && bytes[2] === 0x6d && bytes[3] === 0x70;

      if (isPsd || isClip || isXcf) {
        const layered = decodeLayered(bytes);
        image = TransparencyFlattener.flattenToRaster(layered);
      } else {
        image = decodeRaster(bytes);
      }
    }
  }

  // 2. Process Multi-page Document
  if (document) {
    const docStream = new DocumentStream(document, {
      downsample: shouldDownsample,
      targetDpi
    });

    const processedPages = [];
    for (const page of docStream.streamPages()) {
      let pageImage = page.rasterBackground;
      if (pageImage && requiresCmyk && pageImage.colorSpace !== ColorSpaceType.CMYK) {
        pageImage = convertImageToCmyk(pageImage, options, tacMax);
      }

      processedPages.push(new PageRecord({
        pageNumber: page.pageNumber,
        width: page.width,
        height: page.height,
        boxes: page.boxes,
        dpi: page.dpi,
        image: pageImage,
        layers: page.layers,
        paths: page.paths,
        text: page.text,
        resources: page.resources,
        metadata: page.metadata
      }));
    }

    const processedDoc = new Document({
      title: document.title,
      creator: document.creator,
      pages: processedPages,
      colorSpace: requiresCmyk ? ColorSpaceType.CMYK : document.colorSpace,
      iccProfile: document.iccProfile
    });

    switch (targetFormat) {
      case ExportFormat.PDF_X1A:
        return PdfX1aGenerator.generate(processedDoc, options);

      case ExportFormat.PDF_X4:
        return PdfX4Generator.generate(processedDoc, options);

      case ExportFormat.TIFF: {
        const firstRaster = processedDoc.pages.find(p => p.rasterBackground)?.rasterBackground;
        if (!firstRaster) {
          throw new Error('Document does not contain any raster pages for TIFF export');
        }
        return TiffWriter.write(firstRaster, options);
      }

      case ExportFormat.TIFFSEP: {
        const firstRaster = processedDoc.pages.find(p => p.rasterBackground)?.rasterBackground;
        if (!firstRaster) {
          throw new Error('Document does not contain any raster pages for TIFFSEP export');
        }
        return SeparationPlateGenerator.generatePlates(firstRaster, options);
      }

      default:
        throw new Error(`Unsupported export format: ${targetFormat}`);
    }
  }

  // 3. Process Single Raster Image
  if (shouldDownsample) {
    image = downsampleForPrepress(image, { targetDpi, thresholdDpi: 450 });
  }

  let processedImage = image;
  if (requiresCmyk && image.colorSpace !== ColorSpaceType.CMYK) {
    processedImage = convertImageToCmyk(image, options, tacMax);
  }

  // 4. Export Target
  switch (targetFormat) {
    case ExportFormat.PDF_X1A:
      return PdfX1aGenerator.generate(processedImage, options);

    case ExportFormat.PDF_X4:
      return PdfX4Generator.generate(processedImage, options);

    case ExportFormat.TIFF:
      return TiffWriter.write(processedImage, options);

    case ExportFormat.TIFFSEP:
      return SeparationPlateGenerator.generatePlates(processedImage, options);

    default:
      throw new Error(`Unsupported export format: ${targetFormat}`);
  }
}

