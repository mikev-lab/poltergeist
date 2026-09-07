/**
 * @file document.js
 * @description Prepress multi-page document model and geometric page box definitions for Poltergeist.
 * Strictly zero-dependency and memory-safe.
 */

import { ColorSpaceType } from './image.js';

/**
 * Prepress page bounding boxes (PDF / ISO 15930 specification).
 * Coordinates are [x0, y0, x1, y1] in points (1/72 inch).
 */
export class PageBox {
  /**
   * @param {object} [options]
   * @param {number[]} [options.mediaBox] Physical medium bounds [llx, lly, urx, ury]
   * @param {number[]} [options.cropBox] Visible clipping bounds
   * @param {number[]} [options.bleedBox] Bleed boundaries for printing (typically +3mm / 8.5 pt)
   * @param {number[]} [options.trimBox] Finished trimmed page boundaries
   */
  constructor({
    mediaBox = [0, 0, 612, 792],
    cropBox = null,
    bleedBox = null,
    trimBox = null
  } = {}) {
    this.mediaBox = Object.freeze([...mediaBox]);
    this.cropBox = cropBox ? Object.freeze([...cropBox]) : this.mediaBox;
    this.bleedBox = bleedBox ? Object.freeze([...bleedBox]) : this.cropBox;
    this.trimBox = trimBox ? Object.freeze([...trimBox]) : this.bleedBox;
    Object.freeze(this);
  }

  get width() {
    return Math.abs(this.mediaBox[2] - this.mediaBox[0]);
  }

  get height() {
    return Math.abs(this.mediaBox[3] - this.mediaBox[1]);
  }

  get trimWidth() {
    return Math.abs(this.trimBox[2] - this.trimBox[0]);
  }

  get trimHeight() {
    return Math.abs(this.trimBox[3] - this.trimBox[1]);
  }
}

/**
 * Single page record in a multi-page document.
 */
export class PageRecord {
  /**
   * @param {object} options
   * @param {number} options.pageNumber 1-indexed page sequence number
   * @param {number} [options.width=612]
   * @param {number} [options.height=792]
   * @param {PageBox} [options.boxes]
   * @param {number} [options.dpi=300]
   * @param {Array<import('./layer.js').LayerRecord>} [options.layers=[]]
   * @param {Array<import('./vector.js').VectorPath>} [options.paths=[]]
   * @param {import('./image.js').RasterImage|null} [options.image=null]
   * @param {string} [options.text='']
   * @param {object} [options.resources={}]
   */
  constructor({
    pageNumber,
    pageIndex,
    width,
    widthPts,
    height,
    heightPts,
    boxes = null,
    pageBox = null,
    dpi = 300,
    layers = [],
    paths = [],
    image = null,
    rasterBackground = null,
    rawImageStream = null,
    imageLoader = null,
    text = '',
    resources = {},
    metadata = {}
  }) {
    const pNum = pageNumber !== undefined 
      ? pageNumber 
      : (pageIndex !== undefined ? pageIndex + 1 : 1);

    if (!Number.isInteger(pNum) || pNum < 1) {
      throw new RangeError(`Invalid pageNumber: ${pNum}. Must be 1-indexed integer.`);
    }

    this.pageNumber = pNum;
    this.width = width !== undefined ? width : (widthPts !== undefined ? widthPts : 612);
    this.height = height !== undefined ? height : (heightPts !== undefined ? heightPts : 792);
    this.boxes = boxes || pageBox || new PageBox({ mediaBox: [0, 0, this.width, this.height] });
    this.dpi = dpi > 0 ? dpi : 300;
    this.layers = Object.freeze([...layers]);
    this.paths = Object.freeze([...paths]);
    this.rawImageStream = rawImageStream;
    let _cachedImage = typeof image === 'function' ? null : (image || rasterBackground || null);
    const _loader = typeof image === 'function' ? image : imageLoader;
    Object.defineProperty(this, 'image', {
      get() {
        if (!_cachedImage && _loader) {
          try {
            _cachedImage = _loader();
          } catch {
            // Non-fatal
          }
        }
        return _cachedImage;
      },
      set(v) {
        _cachedImage = v;
      },
      enumerable: true,
      configurable: true
    });
    this.text = text;
    this.resources = Object.freeze({ ...resources });
    this.metadata = Object.freeze({ ...metadata });
    Object.freeze(this);
  }

  get pageIndex() {
    return this.pageNumber - 1;
  }

  get widthPts() {
    return this.width;
  }

  get heightPts() {
    return this.height;
  }

  get pageBox() {
    return this.boxes;
  }

  get rasterBackground() {
    return this.image;
  }
}

/**
 * Multi-page document container for sequential 1:1 stream processing.
 */
export class Document {
  /**
   * @param {object} options
   * @param {string} [options.title='Untitled']
   * @param {string} [options.creator='Poltergeist']
   * @param {Array<PageRecord>} [options.pages=[]]
   * @param {string} [options.colorSpace=ColorSpaceType.RGB]
   * @param {import('../color/icc/profile.js').IccProfile|null} [options.iccProfile=null]
   */
  constructor({
    title = 'Untitled',
    creator = 'Poltergeist',
    pages = [],
    colorSpace = ColorSpaceType.RGB,
    iccProfile = null
  } = {}) {
    this.title = title;
    this.creator = creator;
    this.pages = [...pages];
    this.colorSpace = colorSpace;
    this.iccProfile = iccProfile;
  }

  get pageCount() {
    return this.pages.length;
  }

  /**
   * Appends a page to the document.
   * @param {PageRecord} page
   */
  addPage(page) {
    if (!(page instanceof PageRecord)) {
      throw new TypeError('Page must be an instance of PageRecord.');
    }
    this.pages.push(page);
  }

  /**
   * Retrieves a page by 1-indexed page number.
   * @param {number} pageNumber 1-indexed
   * @returns {PageRecord|null}
   */
  getPage(pageNumber) {
    return this.pages[pageNumber - 1] || null;
  }

  /**
   * Allows iterating pages in sequence.
   */
  [Symbol.iterator]() {
    return this.pages[Symbol.iterator]();
  }
}
