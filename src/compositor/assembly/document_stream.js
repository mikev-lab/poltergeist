/**
 * @file document_stream.js
 * @description 1:1 Page-for-Page sequential document streaming assembler for Poltergeist.
 * Preserves exact source page geometry (mediaBox, cropBox, bleedBox, trimBox) with
 * O(page) bounded memory footprint.
 * Zero external dependencies.
 */

import { Document, PageRecord, PageBox } from '../../types/document.js';
import { downsampleForPrepress } from '../resample/resample.js';

export class DocumentStream {
  /**
   * @param {Document|Iterable<PageRecord>} doc
   * @param {object} [options]
   * @param {boolean} [options.downsample=true]
   * @param {number} [options.targetDpi=300]
   */
  constructor(doc, options = {}) {
    this.doc = doc;
    this.options = options;
    this.downsample = options.downsample !== false;
    this.targetDpi = options.targetDpi || 300;
  }

  /**
   * Returns total page count if known.
   * @returns {number}
   */
  getPageCount() {
    if (this.doc instanceof Document) {
      return this.doc.pages.length;
    }
    return 0;
  }

  /**
   * Sequential generator streaming processed PageRecord objects one by one.
   * Completed pages are yielded immediately, freeing memory before subsequent pages.
   * @returns {Generator<PageRecord, void, unknown>}
   */
  *streamPages() {
    const pages = this.doc instanceof Document ? this.doc.pages : this.doc;

    let index = 0;
    for (const page of pages) {
      // 1. Validate page integrity
      if (!page || typeof page.widthPts !== 'number' || typeof page.heightPts !== 'number') {
        throw new TypeError(`Invalid page record encountered at page index ${index}`);
      }

      // Ensure valid pageBox
      let pageBox = page.pageBox;
      if (!pageBox) {
        pageBox = new PageBox({
          mediaBox: [0, 0, page.widthPts, page.heightPts],
          trimBox: [0, 0, page.widthPts, page.heightPts],
          bleedBox: [0, 0, page.widthPts, page.heightPts]
        });
      }

      // 2. Prepress Downsampling if page has a raster background
      let raster = page.rasterBackground;
      if (raster && this.downsample) {
        raster = downsampleForPrepress(raster, {
          targetDpi: this.targetDpi,
          thresholdDpi: 450
        });
      }

      const processedPage = new PageRecord({
        pageIndex: index,
        widthPts: page.widthPts,
        heightPts: page.heightPts,
        dpi: page.dpi || this.targetDpi,
        pageBox,
        rasterBackground: raster,
        paths: page.paths,
        vectorElements: page.vectorElements,
        textElements: page.textElements,
        metadata: page.metadata
      });

      yield processedPage;
      index++;
    }
  }

  /**
   * Convenience method to collect all processed pages.
   * @returns {PageRecord[]}
   */
  toArray() {
    return Array.from(this.streamPages());
  }
}
