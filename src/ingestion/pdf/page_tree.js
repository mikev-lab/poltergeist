/**
 * @file page_tree.js
 * @description PDF page tree hierarchy traversal and inherited attribute resolution for Poltergeist.
 * Zero-dependency, memory-safe.
 */

import { PageRecord, PageBox } from '../../types/document.js';
import { PdfFilterDecoder } from './filters.js';
import { PdfLexer } from './lexer.js';
import { PdfParser, PdfRef } from './parser.js';
import { JpegDecoder } from '../raster/jpeg/jpeg_decoder.js';

export class PageTreeTraverser {
  /**
   * @param {Uint8Array} bytes
   * @param {import('./xref.js').PdfXrefTable} xref
   */
  constructor(bytes, xref) {
    this.bytes = bytes;
    this.xref = xref;
    this.objectCache = new Map();
  }

  /**
   * Resolves an indirect reference or returns direct object.
   * @param {any} obj
   * @returns {any}
   */
  resolve(obj) {
    if (!obj || !(obj instanceof PdfRef)) {
      return obj;
    }

    if (this.objectCache.has(obj.objNum)) {
      return this.objectCache.get(obj.objNum);
    }

    const offset = this.xref.getOffset(obj.objNum);
    if (offset === undefined || offset < 0 || offset >= this.bytes.length) {
      return null;
    }

    const lexer = new PdfLexer(this.bytes);
    lexer.seek(offset);
    const parser = new PdfParser(lexer);
    const indirectObj = parser.parseIndirectObject();

    if (!indirectObj) return null;

    // Attach stream to value if present
    if (indirectObj.stream && indirectObj.value instanceof Map) {
      indirectObj.value.set('__stream', indirectObj.stream);
    }

    this.objectCache.set(obj.objNum, indirectObj.value);
    return indirectObj.value;
  }

  /**
   * Traverses page tree starting from Catalog (/Root) and collects PageRecords.
   * @returns {PageRecord[]}
   */
  traversePages() {
    const rootRef = this.xref.trailer.get('Root');
    if (!rootRef) {
      throw new Error('PDF trailer is missing /Root catalog reference.');
    }

    const catalog = this.resolve(rootRef);
    if (!catalog || !(catalog instanceof Map)) {
      throw new Error('Failed to resolve /Root catalog dictionary.');
    }

    const pagesRef = catalog.get('Pages');
    if (!pagesRef) {
      throw new Error('PDF /Root catalog is missing /Pages reference.');
    }

    const pagesRoot = this.resolve(pagesRef);
    if (!pagesRoot || !(pagesRoot instanceof Map)) {
      throw new Error('Failed to resolve /Pages root node.');
    }

    const collectedPages = [];
    this._traverseNode(pagesRoot, {}, collectedPages);
    return collectedPages;
  }

  _traverseNode(node, inherited, collectedPages) {
    if (!node || !(node instanceof Map)) return;

    // Update inherited properties
    const currentInherited = {
      mediaBox: node.get('MediaBox') || inherited.mediaBox || [0, 0, 612, 792],
      cropBox: node.get('CropBox') || inherited.cropBox,
      resources: node.get('Resources') || inherited.resources || {}
    };

    const type = node.get('Type');

    if (type === 'Page' || node.has('Contents')) {
      // Leaf page node
      const pageNum = collectedPages.length + 1;
      const mediaBoxArr = this._resolveArray(node.get('MediaBox') || currentInherited.mediaBox);
      const cropBoxArr = this._resolveArray(node.get('CropBox') || currentInherited.cropBox || mediaBoxArr);
      const bleedBoxArr = this._resolveArray(node.get('BleedBox') || cropBoxArr);
      const trimBoxArr = this._resolveArray(node.get('TrimBox') || bleedBoxArr);

      const boxes = new PageBox({
        mediaBox: mediaBoxArr,
        cropBox: cropBoxArr,
        bleedBox: bleedBoxArr,
        trimBox: trimBoxArr
      });

      // Extract contents text/stream
      let pageText = '';
      const contentsRef = node.get('Contents');
      if (contentsRef) {
        const contentsObj = this.resolve(contentsRef);
        if (contentsObj instanceof Map && contentsObj.has('__stream')) {
          const rawStream = contentsObj.get('__stream');
          const filter = contentsObj.get('Filter');
          const decodeParms = this.resolve(contentsObj.get('DecodeParms'));
          try {
            const decompressed = PdfFilterDecoder.decode(rawStream, filter, decodeParms);
            pageText = new TextDecoder('latin1').decode(decompressed);
          } catch {
            pageText = new TextDecoder('latin1').decode(rawStream);
          }
        }
      }

      // Extract raster image from page resources if present
      let pageImage = null;
      const resRef = node.get('Resources') || currentInherited.resources;
      if (resRef) {
        const resources = this.resolve(resRef);
        if (resources instanceof Map && resources.has('XObject')) {
          const xobjMap = this.resolve(resources.get('XObject'));
          if (xobjMap instanceof Map) {
            for (const [, xRef] of xobjMap.entries()) {
              const xObj = this.resolve(xRef);
              if (xObj instanceof Map && xObj.get('Subtype') === 'Image' && xObj.has('__stream')) {
                const stream = xObj.get('__stream');
                const filter = xObj.get('Filter');
                if (filter === 'DCTDecode' || (Array.isArray(filter) && filter.includes('DCTDecode'))) {
                  try {
                    pageImage = JpegDecoder.decode(stream);
                    break;
                  } catch {
                    // Non-fatal
                  }
                }
              }
            }
          }
        }
      }

      collectedPages.push(new PageRecord({
        pageNumber: pageNum,
        width: boxes.width,
        height: boxes.height,
        boxes,
        image: pageImage,
        text: pageText
      }));
      return;
    }

    // Intermediate node: traverse /Kids
    const kids = this._resolveArray(node.get('Kids'));
    if (Array.isArray(kids)) {
      for (const kidRef of kids) {
        const kid = this.resolve(kidRef);
        this._traverseNode(kid, currentInherited, collectedPages);
      }
    }
  }

  _resolveArray(val) {
    if (!val) return null;
    const resolved = this.resolve(val);
    if (Array.isArray(resolved)) {
      return resolved.map(item => this.resolve(item));
    }
    return null;
  }
}
