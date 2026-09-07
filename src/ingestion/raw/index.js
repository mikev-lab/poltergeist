/**
 * @file index.js
 * @description Ingestion module entry point for Camera RAW & Digital Negative formats.
 * Supported: DNG, CR2, NEF, ARW, 3FR, ORF, PEF, RAF, RAW, MEF, ERF, CRW, MRW, X3F.
 * Strictly zero-dependency and memory-safe.
 */

import { RawDecoder } from './raw_decoder.js';
import { RawDemosaicer } from './demosaic.js';
import { CfaPattern, ColorChannel, RawMetadata } from './cfa.js';

export { RawDecoder, RawDemosaicer, CfaPattern, ColorChannel, RawMetadata };

/**
 * Convenience helper to decode a Camera RAW buffer into a RasterImage.
 * @param {Uint8Array} buffer
 * @param {object} [options]
 * @returns {import('../../types/image.js').RasterImage}
 */
export function decodeRaw(buffer, options = {}) {
  return RawDecoder.decode(buffer, options);
}
