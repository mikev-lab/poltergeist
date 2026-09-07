# Multi-Page Document Layouts & Raw PDF Normalization Specification

This document details the architecture, binary formats, and lexical parsers for document layout ingestion and raw PDF normalization implemented in **Poltergeist Phase 4**.

---

## 1. Raw PDF 1.3–2.0 Ingestion & Self-Healing Repair Engine

Poltergeist implements a zero-dependency, pure native PDF lexical tokenizer, recursive descent object parser, and self-healing cross-reference recovery engine designed to replace Ghostscript's `pdfwrite` input pipeline with 100% memory safety.

### 1.1 Lexical Tokenizer (`src/ingestion/pdf/lexer.js`)
- **Tokens**: `KEYWORD`, `BOOLEAN` (`true`, `false`), `NULL` (`null`), `NUMBER` (integers and IEEE 754 floats), `STRING` (literal strings with nested parentheses and octal escapes `\ddd`), `HEX_STRING` (with odd-nibble right padding per ISO 32000), `NAME` (decoding `#xx` hexadecimal escapes), `DICT_START` (`<<`), `DICT_END` (`>>`), `ARRAY_START` (`[`), `ARRAY_END` (`]`), `EOF`.
- **Defensive Error Handling**: Rejects unterminated literal strings and unterminated hex blocks with exact byte offsets.

### 1.2 Recursive Descent Object Parser (`src/ingestion/pdf/parser.js`)
- **Direct & Indirect Objects**: Parses primitive values, arrays, nested dictionaries, and indirect objects (`<num> <gen> obj ... endobj`).
- **Indirect References (`PdfRef`)**: Differentiates numerical values from forward/backward object references (`10 0 R`).
- **Binary Stream Extraction**: Evaluates `/Length` keys from stream dictionaries or dynamically scans for `endstream` markers to cleanly isolate binary payloads.

### 1.3 Cross-Reference Parsing & Self-Healing Recovery (`src/ingestion/pdf/xref.js` & `repair.js`)
- **Classic Table Parser**: Reads `startxref` pointers from the file trailer, parses sub-sections, and extracts the `/Trailer` dictionary (`/Root`, `/Info`, `/Size`).
- **Modern `/XRef` Stream Parser**: Decompresses modern PDF 1.5+ compressed cross-reference streams via `/FlateDecode`.
- **Self-Healing Recovery (`PdfRepair`)**:
  - Parity with Ghostscript `-dPDFSTOPONERROR=false`.
  - When files are truncated, have shifted byte offsets, or are missing `startxref` markers, `PdfRepair` sequentially scans the buffer for `\d+ \d+ obj` boundaries.
  - Reconstructs an in-memory cross-reference table and automatically detects the `/Root` document catalog and `/Info` dictionaries.

### 1.4 Stream Filter Decompressors (`src/ingestion/pdf/filters.js`)
- **`/FlateDecode`**: Native zlib inflation with full predictor support:
  - **TIFF Predictor 2**: Horizontal byte differencing.
  - **PNG Predictors 10–15**: Scanline filtering with Filter 0 (None), 1 (Sub), 2 (Up), 3 (Average), and 4 (Paeth).
- **`/ASCIIHexDecode`**: Strips whitespace, decodes hexadecimal pairs, and pads odd trailing nibbles.
- **`/ASCII85Decode`**: Decompresses Adobe Base-85 encoded groups, expanding `'z'` to four zero bytes.
- **`/RunLengthDecode`**: Unpacks byte-run lengths with copy and repeat runs.

### 1.5 Page Tree Traverser (`src/ingestion/pdf/page_tree.js`)
- Recursively navigates the `/Pages` node hierarchy.
- **Inheritance Resolution**: Inherits `/MediaBox`, `/CropBox`, `/Resources`, and `/Rotate` attributes from parent dictionaries down to leaf `/Page` nodes.
- Extracts page content streams and decompressing filters.

---

## 2. InDesign IDML Package Ingestion (`src/ingestion/document/idml/idml_decoder.js`)

Adobe InDesign Markup Language (IDML) packages are OPC ZIP containers representing complete publication spreads.
- **Spreads (`Spreads/Spread_*.xml`)**: Extracted in sorted order to maintain publication page sequencing.
- **Bleed Extraction**: Parses `BleedTop`, `BleedBottom`, `BleedInside`, and `BleedOutside` from `<Spread>` attributes.
- **Prepress Page Boxes**: Generates `PageBox` structures with distinct finished `TrimBox` and outer expanded `BleedBox`.

---

## 3. Microsoft OpenXML Ingestion (`src/ingestion/document/openxml/`)

### 3.1 Microsoft Word (`word_decoder.js`)
- **Geometry**: Extracted from `<w:pgSz w:w="..." w:h="..." w:orient="..."/>`.
  - Units in twips / dxa (1 pt = 20 dxa).
  - Portrait (612 × 792 pt) vs. Landscape (792 × 612 pt).
- **Margins & TrimBox**: Extracted from `<w:pgMar w:top="..." w:bottom="..." w:left="..." w:right="..."/>`.
- **Page Breaks**: Splits sections and content on `<w:br w:type="page"/>` into sequential `PageRecord` instances.

### 3.2 Microsoft Excel (`excel_decoder.js`)
- Iterates `xl/worksheets/sheet*.xml`.
- Extracts `<pageSetup orientation="..." paperSize="..."/>` to configure orientation and print bounds.

### 3.3 Microsoft PowerPoint (`ppt_decoder.js`)
- **Slide Dimensions**: Extracted from `<p:sldSz cx="..." cy="..."/>` in `ppt/presentation.xml`.
  - Coordinates in EMUs (1 pt = 12,700 EMUs).
  - 16:9 Widescreen (12,192,000 × 6,858,000 EMUs = 960 × 540 pt).
  - 4:3 Standard (9,144,000 × 6,858,000 EMUs = 720 × 540 pt).
- Maps each slide in `ppt/slides/slide*.xml` to a sequential `PageRecord`.

---

## 4. Legacy Office CFBF Ingestion (`src/ingestion/document/legacy/legacy_office.js`)

Parses Compound File Binary Format (CFBF / OLE 2) used by legacy Word (`.doc`), Excel (`.xls`), PowerPoint (`.ppt`), Visio (`.vsd`), and Publisher (`.pub`):
- Validates 8-byte magic header `0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1`.
- Traverses 128-byte directory entries to identify primary streams (`WordDocument`, `Workbook`, `PowerPoint Document`).
- Sets publication bounds and creates initial document pages.

---

## 5. Apple iWork & OpenDocument Ingestion

### 5.1 Apple iWork (`src/ingestion/document/iwork/iwork_decoder.js`)
- Inspects ZIP packages for `.pages`, `.keynote`, and `.numbers`.
- Detects high-fidelity vector preview `QuickLook/Preview.pdf` or `preview.pdf`, decoding full vector pages via `PdfDecoder`.
- Falls back to raster thumbnail previews or application dimension defaults (Keynote 1024 × 768 pt, Pages 612 × 792 pt).

### 5.2 OpenDocument (`src/ingestion/document/odf/odf_decoder.js`)
- Parses `application/vnd.oasis.opendocument.*` packages (`.odt`, `.ods`, `.odp`, `.odg`).
- Unit conversion: Parses `fo:page-width`, `fo:page-height`, `fo:margin-*` supporting `in`, `pt`, `cm`, `mm`, `px`.
- Extracts presentation slides from `<draw:page>` elements and text breaks from `<text:soft-page-break/>`.

---

## 6. PostScript / EPS & Fixed Layouts (XPS / DjVu)

### 6.1 PostScript & Encapsulated PostScript (`src/ingestion/document/postscript/eps_decoder.js`)
- Supports ASCII PostScript (`%!PS-Adobe`) and DOS binary EPS (`0xC5D0D3C6`).
- Parses Document Structuring Conventions (DSC) headers:
  - `%%BoundingBox: llx lly urx ury`
  - `%%HiResBoundingBox: llx lly urx ury`
  - `%%Pages: n`
  - `%%Title: ...` and `%%Creator: ...`

### 6.2 OpenXPS & DjVu (`src/ingestion/document/xps/xps_decoder.js`)
- **OpenXPS**: ZIP package parsing sorted `.fpage` entries; converts 1/96" DIPs to PDF points (1 DIP = 0.75 pt).
- **DjVu**: Parses `AT&T` container and `INFO` chunk dimensions and DPI.
