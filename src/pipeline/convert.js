/**
 * @file convert.js
 * @description Unified "Provide X, Get X" conversion pipeline orchestrator for Poltergeist.
 * Zero-dependency, stream-lined raster-to-prepress transformation.
 */

import fs from 'node:fs';
import { decodeRaster } from '../ingestion/raster/index.js';
import { decodeLayered } from '../ingestion/layered/index.js';
import { isDocumentFormat, decodeDocument } from '../ingestion/document/index.js';
import { PdfDecoder } from '../ingestion/pdf/pdf_decoder.js';
import { SeekableSource } from '../io/seekable.js';
import { FileSeekableSource } from '../io/file_seekable.js';
import { HttpSeekableSource } from '../io/http_seekable.js';
import { WorkerPool } from './worker_pool.js';
import { RawDecoder, decodeRaw } from '../ingestion/raw/index.js';
import { SvgDecoder } from '../ingestion/vector/svg_decoder.js';
import { probeVectorFormat, decodeVector } from '../ingestion/vector/index.js';
import { DxfDecoder } from '../ingestion/cad/dxf_decoder.js';
import { probeCadFormat, decodeCad } from '../ingestion/cad/index.js';
import { probePublicationFormat, decodePublication } from '../ingestion/publication/index.js';
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
import { JpegWriter } from '../export/jpeg/jpeg_writer.js';

export const ExportFormat = Object.freeze({
  PDF_X1A: 'pdf/x-1a',
  PDF_X4: 'pdf/x-4',
  TIFF: 'tiff',
  TIFFSEP: 'tiffsep',
  JPEG: 'jpeg',
  JPG: 'jpg'
});

/**
 * Converts a RasterImage from RGB/Gray to CMYK with TAC limiting.
 * Uses zero-allocation DeviceLink 3D CLUT / 1D LUT buffer transforms.
 * @param {RasterImage} image
 * @param {object} [options]
 * @param {number} [tacMax=300]
 * @param {ColorTransform} [sharedTransform]
 * @returns {RasterImage}
 */
export function convertImageToCmyk(image, options = {}, tacMax = 300, sharedTransform = null) {
  if (image.colorSpace === ColorSpaceType.CMYK) {
    return image;
  }

  const srcProfile = options.sourceIccProfile || image.iccProfile || IccProfile.createSrgbProfile();
  const destProfile = options.targetIccProfile || options.destIccProfile || IccProfile.createCmykReferenceProfile();

  let transform = sharedTransform;
  if (!transform || (image.iccProfile && image.iccProfile !== transform.sourceProfile)) {
    transform = new ColorTransform({
      sourceProfile: srcProfile,
      destinationProfile: destProfile,
      tacLimiter: new TacLimiter({ maxTac: tacMax })
    });
  }

  const { width, height, data } = image;
  const numPixels = width * height;
  const cmykData = new Uint8Array(numPixels * 4);

  if (image.colorSpace === ColorSpaceType.RGB) {
    transform.transformRgbBufferToCmykBuffer(data, cmykData, numPixels, image.channels || 3);
  } else if (image.colorSpace === ColorSpaceType.GRAY) {
    transform.transformGrayBufferToCmykBuffer(data, cmykData, numPixels);
  } else {
    // Fallback for exotic/custom color space
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
 * Generates a calibrated proof image (JPEG or lossless TIFF) from a PageRecord or RasterImage.
 * Supports true-resolution native extraction or specified DPI (72, 300, 600, 1200).
 * @param {PageRecord|RasterImage} source
 * @param {number|string} proofDpi Target resolution (e.g. 72, 300, 600, 1200, 'native', 'source')
 * @param {string} [proofFormat='jpeg'] 'jpeg' or 'tiff'
 * @param {number} [quality=85] Compression quality for JPEG
 * @returns {Uint8Array}
 */
function generateProofImage(source, proofDpi, proofFormat = 'jpeg', quality = 85, rawOverride = null) {
  let raster = rawOverride || source;
  let pageW = 612;
  let pageH = 792;
  let pageDpi = 300;

  if (source instanceof PageRecord || (source && typeof source === 'object' && ('widthPts' in source || 'width' in source || 'image' in source))) {
    raster = rawOverride || source.image || source.rasterBackground;
    pageW = source.widthPts || source.width || 612;
    pageH = source.heightPts || source.height || 792;
    pageDpi = source.dpi || 300;
  } else if (source instanceof RasterImage) {
    raster = source;
    pageDpi = source.dpiX || 300;
    pageW = (source.width / pageDpi) * 72;
    pageH = (source.height / (source.dpiY || pageDpi)) * 72;
  }

  if (!raster) {
    const dpi = (typeof proofDpi === 'number' && proofDpi > 0) ? proofDpi : 72;
    const w = Math.max(1, Math.round(pageW * (dpi / 72)));
    const h = Math.max(1, Math.round(pageH * (dpi / 72)));
    raster = new RasterImage({
      width: w,
      height: h,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      dpiX: dpi,
      dpiY: dpi,
      data: new Uint8Array(w * h * 3).fill(255)
    });
  }

  const isNative = proofDpi === 'native' || proofDpi === 'source' || proofDpi === 'original';
  let targetImg = raster;

  if (!isNative && typeof proofDpi === 'number' && proofDpi > 0) {
    const targetW = Math.max(1, Math.round(pageW * (proofDpi / 72)));
    const targetH = Math.max(1, Math.round(pageH * (proofDpi / 72)));

    if (raster.width !== targetW || raster.height !== targetH) {
      targetImg = resample(raster, targetW, targetH, { filter: 'bicubic' });
    }
  }

  const finalDpi = isNative ? (targetImg.dpiX || pageDpi) : proofDpi;

  if (proofFormat === 'tiff' || proofFormat === 'tif') {
    return TiffWriter.write(targetImg, { compress: true });
  }

  // JPEG proof (convert CMYK -> sRGB if needed)
  let rgbImg = targetImg;
  if (targetImg.colorSpace === ColorSpaceType.CMYK) {
    const numPixels = targetImg.width * targetImg.height;
    const rgbData = new Uint8Array(numPixels * 3);
    const cData = targetImg.data;
    for (let i = 0; i < numPixels; i++) {
      const c = cData[i * 4] / 255.0;
      const m = cData[i * 4 + 1] / 255.0;
      const y = cData[i * 4 + 2] / 255.0;
      const k = cData[i * 4 + 3] / 255.0;
      rgbData[i * 3] = Math.round(255.0 * (1.0 - c) * (1.0 - k));
      rgbData[i * 3 + 1] = Math.round(255.0 * (1.0 - m) * (1.0 - k));
      rgbData[i * 3 + 2] = Math.round(255.0 * (1.0 - y) * (1.0 - k));
    }
    rgbImg = new RasterImage({
      width: targetImg.width,
      height: targetImg.height,
      channels: 3,
      bitsPerSample: 8,
      colorSpace: ColorSpaceType.RGB,
      pixelFormat: PixelFormat.RGB24,
      dpiX: finalDpi,
      dpiY: finalDpi,
      data: rgbData
    });
  }

  return JpegWriter.write(rgbImg, { quality, dpiX: finalDpi, dpiY: finalDpi });
}

/**
 * High-speed prepress conversion orchestrator.
 * Supports raster, layered formats, and multi-page document layouts (PDF, IDML, OpenXML, ODF, iWork, XPS, PS).
 * Supports multi-page splitting, true/high-res proofs, and manga screentone preservation.
 *
 * @param {Uint8Array|Buffer|Document} input 
 * @param {object} [options]
 * @param {string} [options.targetFormat=ExportFormat.PDF_X1A]
 * @param {boolean} [options.downsample=true] Apply prepress threshold downsampling (>450 DPI -> 300 DPI)
 * @param {boolean} [options.bypassDownsampling=false] Direct bypass of downsampling (preserves 600/1200 DPI manga line art)
 * @param {boolean} [options.preserveResolution=false] Alias to bypass downsampling
 * @param {number} [options.targetDpi=300] Target print resolution
 * @param {number} [options.tacMax=300] Total Area Coverage ink limit (300% SWOP, 320% GRACoL)
 * @param {import('../color/icc/profile.js').IccProfile} [options.sourceIccProfile] Input RGB/CMYK profile
 * @param {import('../color/icc/profile.js').IccProfile} [options.targetIccProfile] Destination CMYK profile
 * @param {boolean} [options.splitPages=false] Split multi-page document into individual single-page files
 * @param {boolean} [options.renderProofs=false] Render proof images alongside the main output
 * @param {number|string|Array<number|string>} [options.proofDpi=72] Proof resolution (72, 300, 600, 1200, 'native')
 * @param {string} [options.proofFormat='jpeg'] Proof file format ('jpeg' or 'tiff')
 * @param {number} [options.proofQuality=85] Compression quality for JPEG proofs
 * @param {number} [options.page] Extract specific 1-indexed page number
 * @param {number[]} [options.pages] Extract specific list of 1-indexed page numbers
 * @param {string} [options.jobName='document'] Base job name
 * @param {function} [options.pageNaming] Custom page file naming callback (pageNum, page) => string
 * @returns {Uint8Array|Map<string, Uint8Array>}
 */
export function convert(input, options = {}) {
  if (options.parallel === true) {
    return convertParallel(input, options);
  }

  const targetFormat = (options.targetFormat || options.format || ExportFormat.PDF_X1A).toLowerCase();
  const shouldDownsample = options.downsample !== false &&
    !options.bypassDownsampling &&
    !options.preserveResolution;
  const targetDpi = options.targetDpi || options.dpi || 300;
  const tacMax = options.tacMax || 300;
  const requiresCmyk = targetFormat === ExportFormat.PDF_X1A || targetFormat === ExportFormat.TIFFSEP;
  const splitPages = options.splitPages === true;
  const renderProofs = options.renderProofs === true;
  const proofDpis = Array.isArray(options.proofDpi)
    ? options.proofDpi
    : [options.proofDpi ?? 72];
  const proofFormat = (options.proofFormat || 'jpeg').toLowerCase();
  const proofQuality = options.proofQuality ?? 85;

  let sharedTransform = null;
  if (requiresCmyk) {
    const srcProfile = options.sourceIccProfile || IccProfile.createSrgbProfile();
    const destProfile = options.targetIccProfile || options.destIccProfile || IccProfile.createCmykReferenceProfile();
    sharedTransform = new ColorTransform({
      sourceProfile: srcProfile,
      destinationProfile: destProfile,
      tacLimiter: new TacLimiter({ maxTac: tacMax })
    });
  }

  // 1. Ingest: Sniff Document vs Layered vs Raster vs Raw vs Vector vs CAD vs Publication
  let document = null;
  let image = null;

  if (input instanceof Document) {
    document = input;
  } else if (input instanceof RasterImage) {
    image = input;
  } else if (input instanceof LayeredImage) {
    image = TransparencyFlattener.flattenToRaster(input);
  } else if (typeof input === 'string') {
    if (fs.existsSync(input)) {
      if (PdfDecoder.probe(input)) {
        document = PdfDecoder.decode(input, options);
      } else {
        const fileBytes = fs.readFileSync(input);
        return convert(fileBytes, options);
      }
    } else if (SvgDecoder.probe(input)) {
      document = SvgDecoder.decode(input, options);
    } else if (DxfDecoder.probe(input)) {
      document = DxfDecoder.decode(input, options);
    } else {
      throw new Error('Unsupported text input format or non-existent file path');
    }
  } else if (input instanceof SeekableSource) {
    if (PdfDecoder.probe(input)) {
      document = PdfDecoder.decode(input, options);
    } else {
      const bytes = input.readSync(0, input.size);
      return convert(bytes, options);
    }
  } else {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

    if (RawDecoder.probe(bytes)) {
      image = decodeRaw(bytes, options);
    } else if (probeVectorFormat(bytes)) {
      document = decodeVector(bytes, options);
    } else if (probeCadFormat(bytes)) {
      document = decodeCad(bytes, options);
    } else if (probePublicationFormat(bytes)) {
      document = decodePublication(bytes, options);
    } else if (isDocumentFormat(bytes)) {
      document = decodeDocument(bytes, options);
    } else {
      const isPsd = bytes.length >= 4 && bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53;
      const isClip = bytes.length >= 16 && bytes[0] === 0x53 && bytes[1] === 0x51 && bytes[2] === 0x4c && bytes[3] === 0x69;
      const isXcf = bytes.length >= 9 && bytes[0] === 0x67 && bytes[1] === 0x69 && bytes[2] === 0x6d && bytes[3] === 0x70;

      if (isPsd || isClip || isXcf) {
        const layered = decodeLayered(bytes);
        image = TransparencyFlattener.flattenToRaster(layered);
      } else {
        image = decodeRaster(bytes, options);
      }
    }
  }

  // 2. Process Multi-page Document
  if (document) {
    // Early Page Range Filtering
    if (options.page !== undefined) {
      const pNum = options.page;
      if (!Number.isInteger(pNum) || pNum < 1 || pNum > document.pages.length) {
        throw new RangeError(`Requested page ${pNum} is out of document bounds (1..${document.pages.length})`);
      }
      document.pages = [document.pages[pNum - 1]];
    } else if (Array.isArray(options.pages) && options.pages.length > 0) {
      const selected = [];
      for (const p of options.pages) {
        if (!Number.isInteger(p) || p < 1 || p > document.pages.length) {
          throw new RangeError(`Requested page ${p} is out of document bounds (1..${document.pages.length})`);
        }
        selected.push(document.pages[p - 1]);
      }
      document.pages = selected;
    }

    const docStream = new DocumentStream(document, {
      downsample: shouldDownsample,
      targetDpi
    });

    const processedPages = [];
    const originalRgbPages = [];
    for (const page of docStream.streamPages()) {
      let pageImage = page.image || page.rasterBackground;
      originalRgbPages.push(pageImage);

      if (pageImage && requiresCmyk && pageImage.colorSpace !== ColorSpaceType.CMYK) {
        pageImage = convertImageToCmyk(pageImage, options, tacMax, sharedTransform);
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

    // Multi-page splitting or proofing active
    if (splitPages || renderProofs || (processedPages.length > 1 && (targetFormat === ExportFormat.JPEG || targetFormat === ExportFormat.JPG) && options.firstPageOnly !== true)) {
      const resultMap = new Map();
      const jobName = options.jobName || 'document';

      // If combined master document is requested alongside individual proofs:
      if (!splitPages && (targetFormat === ExportFormat.PDF_X1A || targetFormat === ExportFormat.PDF_X4)) {
        const fullPdf = targetFormat === ExportFormat.PDF_X1A
          ? PdfX1aGenerator.generate(processedDoc, options)
          : PdfX4Generator.generate(processedDoc, options);
        resultMap.set(`${jobName}.pdf`, fullPdf);
      }

      for (let i = 0; i < processedPages.length; i++) {
        const page = processedPages[i];
        const rawPageImage = originalRgbPages[i] || page.image;
        const pageNum = page.pageNumber;
        const baseName = options.pageNaming ? options.pageNaming(pageNum, page) : `page_${pageNum}`;

        // 1. Export main target format if splitPages is active (or multi-page JPEG export)
        if (splitPages || targetFormat === ExportFormat.JPEG || targetFormat === ExportFormat.JPG) {
          switch (targetFormat) {
            case ExportFormat.PDF_X1A: {
              const pdf = PdfX1aGenerator.generate([page], options);
              resultMap.set(`${baseName}.pdf`, pdf);
              break;
            }
            case ExportFormat.PDF_X4: {
              const pdf = PdfX4Generator.generate([page], options);
              resultMap.set(`${baseName}.pdf`, pdf);
              break;
            }
            case ExportFormat.TIFF: {
              const tif = TiffWriter.write(page.image, options);
              resultMap.set(`${baseName}.tif`, tif);
              break;
            }
            case ExportFormat.TIFFSEP: {
              const plates = SeparationPlateGenerator.generatePlates(page.image, { ...options, jobName: baseName });
              for (const [plateName, plateBuf] of plates) {
                resultMap.set(plateName, plateBuf);
              }
              break;
            }
            case ExportFormat.JPEG:
            case ExportFormat.JPG: {
              const jpg = generateProofImage(page, targetDpi, 'jpeg', proofQuality, rawPageImage);
              resultMap.set(`${baseName}.jpg`, jpg);
              break;
            }
          }
        }

        // 2. Export proofs if requested
        if (renderProofs) {
          for (const pDpi of proofDpis) {
            const isNative = pDpi === 'native' || pDpi === 'source' || pDpi === 'original';
            const dpiSuffix = isNative ? '_native' : (proofDpis.length > 1 ? `_${pDpi}dpi` : '');
            const ext = (proofFormat === 'tiff' || proofFormat === 'tif') ? 'tif' : 'jpg';
            let proofFileName = `${baseName}${dpiSuffix}.${ext}`;

            // Prevent collision if splitPages already created that filename
            if (resultMap.has(proofFileName)) {
              proofFileName = `${baseName}_proof${dpiSuffix}.${ext}`;
            }

            const proofBuf = generateProofImage(page, pDpi, proofFormat, proofQuality, rawPageImage);
            resultMap.set(proofFileName, proofBuf);
          }
        }
      }

      // If single page was extracted without splitPages or renderProofs, return single buffer
      if (resultMap.size === 1 && !splitPages && !renderProofs) {
        return resultMap.values().next().value;
      }

      return resultMap;
    }

    // Default multi-page combined export (when neither splitPages nor renderProofs is requested)
    switch (targetFormat) {
      case ExportFormat.PDF_X1A:
        return PdfX1aGenerator.generate(processedDoc, options);

      case ExportFormat.PDF_X4:
        return PdfX4Generator.generate(processedDoc, options);

      case ExportFormat.TIFF: {
        let firstRaster = processedDoc.pages.find(p => p.rasterBackground)?.rasterBackground;
        if (!firstRaster) {
          const firstPage = processedDoc.pages[0];
          const w = Math.round((firstPage?.widthPts || 612) * (targetDpi / 72));
          const h = Math.round((firstPage?.heightPts || 792) * (targetDpi / 72));
          firstRaster = new RasterImage({
            width: w,
            height: h,
            channels: 4,
            bitsPerSample: 8,
            colorSpace: ColorSpaceType.CMYK,
            pixelFormat: PixelFormat.CMYK32,
            dpiX: targetDpi,
            dpiY: targetDpi,
            data: new Uint8Array(w * h * 4)
          });
        }
        return TiffWriter.write(firstRaster, options);
      }

      case ExportFormat.TIFFSEP: {
        let firstRaster = processedDoc.pages.find(p => p.rasterBackground)?.rasterBackground;
        if (!firstRaster) {
          const firstPage = processedDoc.pages[0];
          const w = Math.round((firstPage?.widthPts || 612) * (targetDpi / 72));
          const h = Math.round((firstPage?.heightPts || 792) * (targetDpi / 72));
          firstRaster = new RasterImage({
            width: w,
            height: h,
            channels: 4,
            bitsPerSample: 8,
            colorSpace: ColorSpaceType.CMYK,
            pixelFormat: PixelFormat.CMYK32,
            dpiX: targetDpi,
            dpiY: targetDpi,
            data: new Uint8Array(w * h * 4)
          });
        }
        return SeparationPlateGenerator.generatePlates(firstRaster, options);
      }

      case ExportFormat.JPEG:
      case ExportFormat.JPG: {
        let firstRaster = processedDoc.pages.find(p => p.image)?.image || processedDoc.pages.find(p => p.rasterBackground)?.rasterBackground;
        const firstPage = processedDoc.pages[0];
        const pageW = firstPage?.widthPts || firstPage?.width || 612;
        const pageH = firstPage?.heightPts || firstPage?.height || 792;
        const targetW = Math.round(pageW * (targetDpi / 72));
        const targetH = Math.round(pageH * (targetDpi / 72));

        if (!firstRaster) {
          firstRaster = new RasterImage({
            width: targetW,
            height: targetH,
            channels: 3,
            bitsPerSample: 8,
            colorSpace: ColorSpaceType.RGB,
            pixelFormat: PixelFormat.RGB24,
            dpiX: targetDpi,
            dpiY: targetDpi,
            data: new Uint8Array(targetW * targetH * 3).fill(255)
          });
        } else if (firstRaster.width !== targetW || firstRaster.height !== targetH) {
          firstRaster = resample(firstRaster, targetW, targetH, { filter: 'bicubic' });
        }
        return JpegWriter.write(firstRaster, { ...options, dpiX: targetDpi, dpiY: targetDpi });
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
    processedImage = convertImageToCmyk(image, options, tacMax, sharedTransform);
  }

  // 4. Export Target (with optional proofing)
  if (renderProofs) {
    const resultMap = new Map();
    const jobName = options.jobName || 'image';

    let mainBytes;
    let mainExt = 'pdf';
    switch (targetFormat) {
      case ExportFormat.PDF_X1A:
        mainBytes = PdfX1aGenerator.generate(processedImage, options);
        mainExt = 'pdf';
        break;
      case ExportFormat.PDF_X4:
        mainBytes = PdfX4Generator.generate(processedImage, options);
        mainExt = 'pdf';
        break;
      case ExportFormat.TIFF:
        mainBytes = TiffWriter.write(processedImage, options);
        mainExt = 'tif';
        break;
      case ExportFormat.TIFFSEP:
        return SeparationPlateGenerator.generatePlates(processedImage, options);
      case ExportFormat.JPEG:
      case ExportFormat.JPG:
        mainBytes = JpegWriter.write(processedImage, { ...options, dpiX: targetDpi, dpiY: targetDpi });
        mainExt = 'jpg';
        break;
      default:
        throw new Error(`Unsupported export format: ${targetFormat}`);
    }
    resultMap.set(`${jobName}.${mainExt}`, mainBytes);

    for (const pDpi of proofDpis) {
      const isNative = pDpi === 'native' || pDpi === 'source' || pDpi === 'original';
      const dpiSuffix = isNative ? '_native' : (proofDpis.length > 1 ? `_${pDpi}dpi` : '');
      const ext = (proofFormat === 'tiff' || proofFormat === 'tif') ? 'tif' : 'jpg';
      let proofFileName = `${jobName}_proof${dpiSuffix}.${ext}`;
      if (resultMap.has(proofFileName)) {
        proofFileName = `${jobName}_proof2${dpiSuffix}.${ext}`;
      }
      const proofBuf = generateProofImage(image, pDpi, proofFormat, proofQuality);
      resultMap.set(proofFileName, proofBuf);
    }

    return resultMap;
  }

  switch (targetFormat) {
    case ExportFormat.PDF_X1A:
      return PdfX1aGenerator.generate(processedImage, options);

    case ExportFormat.PDF_X4:
      return PdfX4Generator.generate(processedImage, options);

    case ExportFormat.TIFF:
      return TiffWriter.write(processedImage, options);

    case ExportFormat.TIFFSEP:
      return SeparationPlateGenerator.generatePlates(processedImage, options);

    case ExportFormat.JPEG:
    case ExportFormat.JPG: {
      let finalImg = image;
      if (options.dpi || options.targetDpi) {
        const reqDpi = options.dpi || options.targetDpi;
        if (reqDpi < (image.dpiX || 300)) {
          const scale = reqDpi / (image.dpiX || 300);
          const targetW = Math.max(1, Math.round(image.width * scale));
          const targetH = Math.max(1, Math.round(image.height * scale));
          finalImg = resample(image, targetW, targetH, { filter: 'bicubic' });
        }
      }
      return JpegWriter.write(finalImg, { ...options, dpiX: targetDpi, dpiY: targetDpi });
    }

    default:
      throw new Error(`Unsupported export format: ${targetFormat}`);
  }
}

/**
 * Asynchronous multi-core prepress conversion orchestrator.
 * Scales throughput across CPU cores using Node.js worker threads.
 *
 * @param {Uint8Array|Buffer|Document|RasterImage|string|SeekableSource} input
 * @param {object} [options]
 * @param {number} [options.maxWorkers] Maximum worker threads
 * @returns {Promise<Uint8Array|Map<string, Uint8Array>>}
 */
export async function convertParallel(input, options = {}) {
  // 1. Handle HTTP / HTTPS URL
  if (typeof input === 'string' && (input.startsWith('http://') || input.startsWith('https://'))) {
    const httpSource = await HttpSeekableSource.create(input);
    try {
      return await convertParallel(httpSource, options);
    } finally {
      await httpSource.close();
    }
  }

  // 2. Ingest document or image
  let document = null;
  let image = null;

  if (input instanceof Document) {
    document = input;
  } else if (input instanceof RasterImage) {
    image = input;
  } else if (input instanceof LayeredImage) {
    image = TransparencyFlattener.flattenToRaster(input);
  } else if (typeof input === 'string') {
    if (fs.existsSync(input)) {
      if (PdfDecoder.probe(input)) {
        document = PdfDecoder.decode(input, options);
      } else {
        const fileBytes = fs.readFileSync(input);
        return convertParallel(fileBytes, options);
      }
    } else if (SvgDecoder.probe(input)) {
      document = SvgDecoder.decode(input, options);
    } else if (DxfDecoder.probe(input)) {
      document = DxfDecoder.decode(input, options);
    } else {
      throw new Error('Unsupported text input format or non-existent file path');
    }
  } else if (input instanceof SeekableSource) {
    if (PdfDecoder.probe(input)) {
      document = PdfDecoder.decode(input, options);
    } else {
      const bytes = input.readSync(0, input.size);
      return convertParallel(bytes, options);
    }
  } else {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (RawDecoder.probe(bytes)) {
      image = decodeRaw(bytes, options);
    } else if (probeVectorFormat(bytes)) {
      document = decodeVector(bytes, options);
    } else if (probeCadFormat(bytes)) {
      document = decodeCad(bytes, options);
    } else if (probePublicationFormat(bytes)) {
      document = decodePublication(bytes, options);
    } else if (isDocumentFormat(bytes)) {
      document = decodeDocument(bytes, options);
    } else {
      const isPsd = bytes.length >= 4 && bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53;
      const isClip = bytes.length >= 16 && bytes[0] === 0x53 && bytes[1] === 0x51 && bytes[2] === 0x4c && bytes[3] === 0x69;
      const isXcf = bytes.length >= 9 && bytes[0] === 0x67 && bytes[1] === 0x69 && bytes[2] === 0x6d && bytes[3] === 0x70;

      if (isPsd || isClip || isXcf) {
        const layered = decodeLayered(bytes);
        image = TransparencyFlattener.flattenToRaster(layered);
      } else {
        image = decodeRaster(bytes, options);
      }
    }
  }

  // If single image or document with <= 1 page, worker pool overhead is unnecessary
  if (image) {
    return convert(image, { ...options, parallel: false });
  }

  if (!document) {
    throw new Error('Failed to ingest document or image from input');
  }

  // Filter page range if requested
  if (options.page !== undefined) {
    const pNum = options.page;
    if (!Number.isInteger(pNum) || pNum < 1 || pNum > document.pages.length) {
      throw new RangeError(`Requested page ${pNum} is out of document bounds (1..${document.pages.length})`);
    }
    document.pages = [document.pages[pNum - 1]];
  } else if (Array.isArray(options.pages) && options.pages.length > 0) {
    const selected = [];
    for (const p of options.pages) {
      if (!Number.isInteger(p) || p < 1 || p > document.pages.length) {
        throw new RangeError(`Requested page ${p} is out of document bounds (1..${document.pages.length})`);
      }
      selected.push(document.pages[p - 1]);
    }
    document.pages = selected;
  }

  if (document.pages.length <= 1) {
    return convert(document, { ...options, parallel: false });
  }

  const targetFormat = (options.targetFormat || options.format || ExportFormat.PDF_X1A).toLowerCase();
  const splitPages = options.splitPages === true;
  const renderProofs = options.renderProofs === true;
  const isMultiJpeg = (targetFormat === ExportFormat.JPEG || targetFormat === ExportFormat.JPG) && options.firstPageOnly !== true;

  const pool = new WorkerPool({ maxWorkers: options.maxWorkers });

  try {
    // Mode A: Splitting, proofs, or multi-page JPEG -> Each worker produces finished files
    if (splitPages || renderProofs || isMultiJpeg) {
      const taskPromises = document.pages.map((page, index) => {
        const pageNum = page.pageNumber || (index + 1);
        const baseName = options.pageNaming ? options.pageNaming(pageNum, page) : `page_${pageNum}`;
        const pageImage = page.image || page.rasterBackground;

        const workerOptions = { ...options };
        delete workerOptions.pageNaming;
        delete workerOptions.page;
        delete workerOptions.pages;

        return pool.execute({
          mode: 'convert_page',
          baseName,
          pageData: {
            pageNumber: pageNum,
            width: page.width,
            height: page.height,
            dpi: page.dpi,
            boxes: page.boxes,
            image: pageImage ? {
              width: pageImage.width,
              height: pageImage.height,
              channels: pageImage.channels,
              bitsPerSample: pageImage.bitsPerSample,
              colorSpace: pageImage.colorSpace,
              pixelFormat: pageImage.pixelFormat,
              dpiX: pageImage.dpiX,
              dpiY: pageImage.dpiY,
              data: pageImage.data
            } : null,
            layers: page.layers,
            paths: page.paths,
            text: page.text,
            resources: page.resources,
            metadata: page.metadata
          },
          options: {
            ...workerOptions,
            parallel: false,
            splitPages: true,
            jobName: baseName
          }
        });
      });

      const results = await Promise.all(taskPromises);

      const resultMap = new Map();
      const jobName = options.jobName || 'document';

      // If combined master PDF was also requested alongside individual proofs:
      if (!splitPages && (targetFormat === ExportFormat.PDF_X1A || targetFormat === ExportFormat.PDF_X4)) {
        const singleDoc = convert(document, { ...options, splitPages: false, renderProofs: false, parallel: false });
        resultMap.set(`${jobName}.pdf`, singleDoc);
      }

      for (const res of results) {
        if (Array.isArray(res)) {
          for (const item of res) {
            resultMap.set(item.filename, item.buf);
          }
        } else if (res && typeof res === 'object' && res.filename && res.buf) {
          resultMap.set(res.filename, res.buf);
        }
      }

      return resultMap;
    }

    // Mode B: Combined multi-page export (e.g. 50-page PDF/X-1a)
    // Run downsampling + CMYK conversion in parallel across workers!
    const workerOptions = { ...options };
    delete workerOptions.pageNaming;
    delete workerOptions.page;
    delete workerOptions.pages;

    const taskPromises = document.pages.map((page, index) => {
      const pageNum = page.pageNumber || (index + 1);
      const pageImage = page.image || page.rasterBackground;

      return pool.execute({
        mode: 'process_page',
        pageData: {
          pageNumber: pageNum,
          width: page.width,
          height: page.height,
          dpi: page.dpi,
          boxes: page.boxes,
          image: pageImage ? {
            width: pageImage.width,
            height: pageImage.height,
            channels: pageImage.channels,
            bitsPerSample: pageImage.bitsPerSample,
            colorSpace: pageImage.colorSpace,
            pixelFormat: pageImage.pixelFormat,
            dpiX: pageImage.dpiX,
            dpiY: pageImage.dpiY,
            data: pageImage.data
          } : null,
          layers: page.layers,
          paths: page.paths,
          text: page.text,
          resources: page.resources,
          metadata: page.metadata
        },
        options: {
          ...workerOptions,
          parallel: false
        }
      });
    });

    const processedPageResults = await Promise.all(taskPromises);
    const processedPages = processedPageResults.map(p => {
      const pageObj = p.page || p;
      let img = pageObj.image;
      if (img && !(img instanceof RasterImage) && typeof img === 'object') {
        img = new RasterImage(img);
      }
      return new PageRecord({
        ...pageObj,
        image: img
      });
    });

    const processedDoc = new Document({
      title: document.title,
      creator: document.creator,
      pages: processedPages,
      colorSpace: (targetFormat === ExportFormat.PDF_X1A || targetFormat === ExportFormat.TIFFSEP) ? ColorSpaceType.CMYK : document.colorSpace,
      iccProfile: document.iccProfile
    });

    return convert(processedDoc, { ...options, parallel: false, downsample: false });
  } finally {
    await pool.terminate();
  }
}

