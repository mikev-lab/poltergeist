/**
 * @file index.js
 * @description Ingestion module entry point for Architectural & Engineering CAD formats.
 * Supported: AutoCAD DXF (.dxf ASCII), AutoCAD DWG (.dwg binary).
 * Strictly zero-dependency and memory-safe.
 */

import { DxfDecoder, CAD_PAPER_SIZES, ACI_PALETTE } from './dxf_decoder.js';
import { DwgDecoder, DWG_VERSIONS } from './dwg_decoder.js';

export { DxfDecoder, DwgDecoder, CAD_PAPER_SIZES, ACI_PALETTE, DWG_VERSIONS };

/**
 * Probes whether the input buffer matches any supported CAD format.
 * @param {Uint8Array|string} input
 * @returns {string|null} 'dxf', 'dwg', or null
 */
export function probeCadFormat(input) {
  if (!input) return null;
  if (DxfDecoder.probe(input)) return 'dxf';
  if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
    if (DwgDecoder.probe(input)) return 'dwg';
  }
  return null;
}

/**
 * Decodes any supported CAD drawing buffer into a Document model.
 * @param {Uint8Array|string} input
 * @param {object} [options]
 * @returns {import('../../types/document.js').Document}
 */
export function decodeCad(input, options = {}) {
  const format = probeCadFormat(input);
  switch (format) {
    case 'dxf':
      return DxfDecoder.decode(input, options);
    case 'dwg':
      return DwgDecoder.decode(input, options);
    default:
      throw new Error('Unsupported or unrecognized CAD schematic format.');
  }
}
