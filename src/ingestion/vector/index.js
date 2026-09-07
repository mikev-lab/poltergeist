/**
 * @file index.js
 * @description Ingestion module entry point for Vector Graphics.
 * Supported: SVG, Adobe Illustrator (.ai), CorelDRAW (.cdr), Windows Metafile (.wmf, .emf).
 * Strictly zero-dependency and memory-safe.
 */

import { SvgDecoder } from './svg_decoder.js';
import { AiDecoder } from './ai_decoder.js';
import { CdrDecoder } from './cdr_decoder.js';
import { WmfDecoder } from './wmf_decoder.js';

export { SvgDecoder, AiDecoder, CdrDecoder, WmfDecoder };

/**
 * Probes whether the input buffer matches any supported vector graphic format.
 * @param {Uint8Array|string} input
 * @returns {string|null} 'svg', 'ai', 'cdr', 'wmf', or null
 */
export function probeVectorFormat(input) {
  if (!input) return null;
  if (SvgDecoder.probe(input)) return 'svg';
  if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
    if (CdrDecoder.probe(input)) return 'cdr';
    if (WmfDecoder.probe(input)) return 'wmf';
    if (AiDecoder.probe(input)) return 'ai';
  }
  return null;
}

/**
 * Decodes any supported vector graphic buffer into a Document model.
 * @param {Uint8Array|string} input
 * @param {object} [options]
 * @returns {import('../../types/document.js').Document}
 */
export function decodeVector(input, options = {}) {
  const format = probeVectorFormat(input);
  switch (format) {
    case 'svg':
      return SvgDecoder.decode(input, options);
    case 'ai':
      return AiDecoder.decode(input, options);
    case 'cdr':
      return CdrDecoder.decode(input, options);
    case 'wmf':
      return WmfDecoder.decode(input, options);
    default:
      throw new Error('Unsupported or unrecognized vector graphics format.');
  }
}
