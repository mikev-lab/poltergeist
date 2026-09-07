/**
 * @file epub_decoder.js
 * @description Native EPUB (Electronic Publication) OCF container and spine parser for Poltergeist.
 * Extracts Dublin Core metadata, resolves OPF manifest and spine linear reading order,
 * and compiles chapters/illustrations into sequential PageRecords.
 * Strictly zero-dependency and memory-safe.
 */

import { ZipReader } from '../common/zip_reader.js';
import { decodeRaster } from '../raster/index.js';
import { Document, PageRecord, PageBox } from '../../types/document.js';
import { ColorSpaceType } from '../../types/image.js';

export class EpubDecoder {
  /**
   * Sniffs whether buffer is an EPUB archive.
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!buffer || buffer.length < 30) return false;
    if (!ZipReader.probe(buffer)) return false;

    try {
      const zip = new ZipReader(buffer);
      if (zip.has('mimetype')) {
        const mime = zip.readText('mimetype').trim();
        if (mime === 'application/epub+zip') return true;
      }
      if (zip.has('META-INF/container.xml')) {
        return true;
      }
    } catch {
      // Not an EPUB
    }

    return false;
  }

  /**
   * Decodes an EPUB archive into a Document model.
   * @param {Uint8Array} buffer
   * @param {object} [options]
   * @returns {Document}
   */
  static decode(buffer, options = {}) {
    if (!EpubDecoder.probe(buffer)) {
      throw new Error('Unsupported or invalid EPUB archive format.');
    }

    const zip = new ZipReader(buffer);

    // 1. Read META-INF/container.xml to find OPF path
    if (!zip.has('META-INF/container.xml')) {
      throw new Error("Invalid EPUB: missing 'META-INF/container.xml'.");
    }

    const containerXml = zip.readText('META-INF/container.xml');
    const rootfileMatch = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
    if (!rootfileMatch) {
      throw new Error("Invalid EPUB container.xml: no rootfile full-path found.");
    }

    const opfPath = rootfileMatch[1];
    if (!zip.has(opfPath)) {
      throw new Error(`Invalid EPUB: package file not found at '${opfPath}'.`);
    }

    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const opfText = zip.readText(opfPath);

    // 2. Extract Metadata (dc:title, dc:creator)
    let title = options.title || 'EPUB Publication';
    let creator = 'Poltergeist EPUB Engine';

    const titleMatch = opfText.match(/<dc:title\b[^>]*>([^<]+)<\/dc:title>/i);
    if (titleMatch) title = titleMatch[1].trim();

    const creatorMatch = opfText.match(/<dc:creator\b[^>]*>([^<]+)<\/dc:creator>/i);
    if (creatorMatch) creator = `${creatorMatch[1].trim()} (Poltergeist)`;

    // 3. Extract Manifest (id -> href, media-type)
    const manifest = new Map();
    const itemRegex = /<item\b([^>]+)\/?>/gi;
    let match;
    while ((match = itemRegex.exec(opfText)) !== null) {
      const attrs = match[1];
      const id = EpubDecoder._getAttr(attrs, 'id');
      const href = EpubDecoder._getAttr(attrs, 'href');
      const mediaType = EpubDecoder._getAttr(attrs, 'media-type');
      if (id && href) {
        manifest.set(id, { href, mediaType });
      }
    }

    // 4. Extract Spine reading order
    const spineItemrefs = [];
    const spineRegex = /<itemref\b([^>]+)\/?>/gi;
    while ((match = spineRegex.exec(opfText)) !== null) {
      const attrs = match[1];
      const idref = EpubDecoder._getAttr(attrs, 'idref');
      if (idref) {
        spineItemrefs.push(idref);
      }
    }

    // 5. Build pages sequentially
    const pages = [];
    const widthPts = 612;
    const heightPts = 792;
    let pageNum = 1;

    for (const idref of spineItemrefs) {
      const item = manifest.get(idref);
      if (!item) continue;

      const fullHref = opfDir + item.href;
      if (!zip.has(fullHref)) continue;

      let pageImage = null;
      let pageText = '';

      if (item.mediaType && item.mediaType.startsWith('image/')) {
        // Direct image chapter
        try {
          pageImage = decodeRaster(zip.read(fullHref));
        } catch {
          // Ignore decode failure
        }
      } else {
        // XHTML/HTML chapter
        const xhtml = zip.readText(fullHref);
        // Strip XML/HTML tags for plain text representation
        pageText = xhtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        // Check if there is an embedded cover or illustration image
        const imgMatch = xhtml.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i) ||
                         xhtml.match(/<image\b[^>]*\bxlink:href\s*=\s*["']([^"']+)["']/i);
        if (imgMatch) {
          const imgRel = imgMatch[1];
          const imgFull = opfDir + imgRel;
          if (zip.has(imgFull)) {
            try {
              pageImage = decodeRaster(zip.read(imgFull));
            } catch {
              // Ignore
            }
          }
        }
      }

      const pWidth = pageImage ? (pageImage.width * 72) / pageImage.dpiX : widthPts;
      const pHeight = pageImage ? (pageImage.height * 72) / pageImage.dpiY : heightPts;

      const pageBox = new PageBox({
        mediaBox: [0, 0, pWidth, pHeight],
        trimBox: [0, 0, pWidth, pHeight]
      });

      const page = new PageRecord({
        pageNumber: pageNum++,
        width: pWidth,
        height: pHeight,
        pageBox,
        image: pageImage,
        text: pageText.slice(0, 10000), // bounded memory
        metadata: {
          chapterHref: item.href,
          mediaType: item.mediaType
        }
      });

      pages.push(page);
    }

    if (pages.length === 0) {
      // Fallback single page
      pages.push(new PageRecord({
        pageNumber: 1,
        width: widthPts,
        height: heightPts,
        text: title
      }));
    }

    return new Document({
      title,
      creator,
      pages,
      colorSpace: ColorSpaceType.RGB
    });
  }

  /**
   * @private
   */
  static _getAttr(attrsStr, name) {
    const reg = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
    const m = attrsStr.match(reg);
    return m ? m[1] : null;
  }
}
