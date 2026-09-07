/**
 * @file index.js
 * @description Unified document layout ingestion router and format dispatcher.
 * Dispatches PDF, IDML, OpenXML, Legacy Office, Apple iWork, OpenDocument, PostScript, XPS, DjVu.
 * Zero external dependencies.
 */

import { PdfDecoder } from '../pdf/pdf_decoder.js';
import { IdmlDecoder } from './idml/idml_decoder.js';
import { WordDecoder } from './openxml/word_decoder.js';
import { ExcelDecoder } from './openxml/excel_decoder.js';
import { PptDecoder } from './openxml/ppt_decoder.js';
import { LegacyOfficeDecoder } from './legacy/legacy_office.js';
import { IworkDecoder } from './iwork/iwork_decoder.js';
import { OdfDecoder } from './odf/odf_decoder.js';
import { EpsDecoder } from './postscript/eps_decoder.js';
import { XpsDecoder } from './xps/xps_decoder.js';

export {
  PdfDecoder,
  IdmlDecoder,
  WordDecoder,
  ExcelDecoder,
  PptDecoder,
  LegacyOfficeDecoder,
  IworkDecoder,
  OdfDecoder,
  EpsDecoder,
  XpsDecoder
};

/**
 * Sniffs whether a buffer is any supported document layout format.
 * @param {Uint8Array} buffer
 * @returns {boolean}
 */
export function isDocumentFormat(buffer) {
  if (!buffer || buffer.length < 4) return false;
  return (
    PdfDecoder.probe(buffer) ||
    EpsDecoder.probe(buffer) ||
    LegacyOfficeDecoder.probe(buffer) ||
    XpsDecoder.probe(buffer) ||
    IdmlDecoder.probe(buffer) ||
    WordDecoder.probe(buffer) ||
    ExcelDecoder.probe(buffer) ||
    PptDecoder.probe(buffer) ||
    OdfDecoder.probe(buffer) ||
    IworkDecoder.probe(buffer)
  );
}

/**
 * Automatically detects the document format and decodes it into a Document container.
 * @param {Uint8Array} buffer
 * @param {object} [options]
 * @returns {import('../../types/document.js').Document}
 */
export function decodeDocument(buffer, options = {}) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  // 1. PDF
  if (PdfDecoder.probe(bytes)) {
    return PdfDecoder.decode(bytes, options);
  }

  // 2. PostScript / EPS
  if (EpsDecoder.probe(bytes)) {
    return EpsDecoder.decode(bytes, options);
  }

  // 3. Legacy Office CFBF
  if (LegacyOfficeDecoder.probe(bytes)) {
    return LegacyOfficeDecoder.decode(bytes, options);
  }

  // 4. DjVu (starts with AT&T)
  if (XpsDecoder.probe(bytes) && bytes[0] === 0x41 && bytes[1] === 0x54) {
    return XpsDecoder.decode(bytes, options);
  }

  // 5. ZIP containers (IDML, OpenXML, ODF, iWork, XPS)
  if (IdmlDecoder.probe(bytes)) {
    return IdmlDecoder.decode(bytes, options);
  }
  if (WordDecoder.probe(bytes)) {
    return WordDecoder.decode(bytes, options);
  }
  if (ExcelDecoder.probe(bytes)) {
    return ExcelDecoder.decode(bytes, options);
  }
  if (PptDecoder.probe(bytes)) {
    return PptDecoder.decode(bytes, options);
  }
  if (OdfDecoder.probe(bytes)) {
    return OdfDecoder.decode(bytes, options);
  }
  if (XpsDecoder.probe(bytes)) {
    return XpsDecoder.decode(bytes, options);
  }
  if (IworkDecoder.probe(bytes)) {
    return IworkDecoder.decode(bytes, options);
  }

  throw new Error('Unsupported or unrecognized document layout format');
}
