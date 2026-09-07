/**
 * @file convert_worker.js
 * @description Dedicated worker thread executor for Poltergeist's multi-core parallel pipeline.
 * Runs page-level conversions in isolated V8 threads without main-thread blocking.
 */

import { parentPort } from 'node:worker_threads';
import { convert, convertImageToCmyk } from './convert.js';
import { Document, PageRecord } from '../types/document.js';
import { RasterImage, ColorSpaceType } from '../types/image.js';
import { JpegDecoder } from '../ingestion/raster/jpeg/jpeg_decoder.js';
import { downsampleForPrepress } from '../compositor/resample/resample.js';

if (parentPort) {
  parentPort.on('message', (task) => {
    const { taskId, mode, pageData, options } = task;

    try {
      if (!pageData) {
        throw new Error('Task missing pageData');
      }

      let image = pageData.image;
      if (!image && pageData.rawImageStream) {
        try {
          image = JpegDecoder.decode(pageData.rawImageStream, options);
        } catch {
          // non-fatal
        }
      }

      if (image && !(image instanceof RasterImage) && typeof image === 'object') {
        image = new RasterImage(image);
      }

      if (mode === 'process_page') {
        const shouldDownsample = options.downsample !== false &&
          !options.bypassDownsampling &&
          !options.preserveResolution;
        const targetDpi = options.targetDpi || options.dpi || 300;
        const tacMax = options.tacMax || 300;
        const targetFormat = (options.targetFormat || options.format || 'pdf/x-1a').toLowerCase();
        const requiresCmyk = targetFormat === 'pdf/x-1a' || targetFormat === 'tiffsep';

        let processedImage = image;
        if (processedImage && shouldDownsample) {
          processedImage = downsampleForPrepress(processedImage, { targetDpi, thresholdDpi: 450 });
        }
        if (processedImage && requiresCmyk && processedImage.colorSpace !== ColorSpaceType.CMYK) {
          processedImage = convertImageToCmyk(processedImage, options, tacMax);
        }

        const resultPage = {
          pageNumber: pageData.pageNumber,
          width: pageData.width,
          height: pageData.height,
          boxes: pageData.boxes,
          dpi: pageData.dpi,
          image: processedImage,
          layers: pageData.layers,
          paths: pageData.paths,
          text: pageData.text,
          resources: pageData.resources,
          metadata: pageData.metadata
        };

        parentPort.postMessage({ taskId, success: true, page: resultPage });
        return;
      }

      const page = new PageRecord({
        ...pageData,
        image
      });

      const singleDoc = new Document({
        title: options.title || 'Page',
        pages: [page]
      });

      const workerOptions = { ...options };
      if (task.baseName) {
        workerOptions.pageNaming = () => task.baseName;
      }

      // Convert page with options
      const result = convert(singleDoc, workerOptions);

      if (result instanceof Map) {
        const fileList = [];
        for (const [filename, buf] of result.entries()) {
          fileList.push({ filename, buf });
        }
        parentPort.postMessage({ taskId, success: true, files: fileList });
      } else {
        parentPort.postMessage({ taskId, success: true, data: result });
      }
    } catch (err) {
      parentPort.postMessage({
        taskId,
        success: false,
        error: err.message,
        stack: err.stack
      });
    }
  });
}

