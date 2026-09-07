/**
 * @file index.js
 * @description Ingestion module entry point for Digital Publications & Comics.
 * Supported: Comic Book Archives (.cbz, .cbr), eBooks (.epub).
 * Strictly zero-dependency and memory-safe.
 */

import { ComicDecoder } from './comic_decoder.js';
import { EpubDecoder } from './epub_decoder.js';

export { ComicDecoder, EpubDecoder };

/**
 * Probes whether the input buffer matches any supported publication format.
 * @param {Uint8Array} buffer
 * @returns {string|null} 'comic', 'epub', or null
 */
export function probePublicationFormat(buffer) {
  if (!buffer) return null;
  if (EpubDecoder.probe(buffer)) return 'epub';
  if (ComicDecoder.probe(buffer)) return 'comic';
  return null;
}

/**
 * Decodes any supported publication buffer into a Document model.
 * @param {Uint8Array} buffer
 * @param {object} [options]
 * @returns {import('../../types/document.js').Document}
 */
export function decodePublication(buffer, options = {}) {
  const format = probePublicationFormat(buffer);
  switch (format) {
    case 'epub':
      return EpubDecoder.decode(buffer, options);
    case 'comic':
      return ComicDecoder.decode(buffer, options);
    default:
      throw new Error('Unsupported or unrecognized publication format.');
  }
}
