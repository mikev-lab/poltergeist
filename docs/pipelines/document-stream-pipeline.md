# 1:1 Sequential Document Streaming & Prepress Assembly Pipeline

This document specifies the architecture of the **1:1 Page-for-Page Streaming Assembler** and multi-page prepress compilation engine implemented in **Poltergeist Phase 4**.

---

## 1. Architectural Mission: "Provide X, Get X"

Poltergeist enforces a strict 1:1 transformation paradigm:
1. **Zero Imposition Mutation**: Input documents containing N pages are output as exactly N pages. Poltergeist does not artificially alter reader order, impose saddle-stitching, or fold spreads unless explicitly configured.
2. **Exact Geometry Preservation**:
   - `MediaBox`: The physical paper boundaries.
   - `CropBox`: The default viewing and clipping region.
   - `BleedBox`: The expanded printing boundary accommodating press trim variations.
   - `TrimBox`: The finished trimmed page edge.
3. **Bounded Memory Footprint (O(page))**: Large multi-page documents (e.g. 500-page catalogs or multi-gigabyte files) must not load all rasterized page buffers into memory simultaneously. Each page is processed sequentially and unreferenced for immediate garbage collection.

---

## 2. Document Streaming Pipeline (`src/compositor/assembly/document_stream.js`)

```text
Input File (PDF, IDML, DOCX, XLSX, PPTX, ODF, Pages, EPS, XPS)
   │
   ▼
Unified decodeDocument() / decodeRaster() / decodeLayered()
   │
   ▼
Document Container (pages: PageRecord[])
   │
   ▼
DocumentStream.streamPages()  <-- Yields PageRecord sequentially
   │
   ├─► Prepress Downsampling (threshold > 450 DPI -> 300 DPI)
   ├─► Color Space Conversion (RGB/Gray -> DeviceCMYK + TAC limiting)
   │
   ▼
Prepress Export Target
   ├─► PDF/X-1a Generator (ISO 15930-1, DeviceCMYK, multi-page /Pages tree)
   ├─► PDF/X-4 Generator (ISO 15930-7, DeviceCMYK/RGB, transparency groups)
   └─► Discrete Plate Generator (tiffsep C, M, Y, K)
```

---

## 3. Multi-Page Prepress PDF Generation

Both `PdfX1aGenerator` (`src/export/pdf/pdfx1a.js`) and `PdfX4Generator` (`src/export/pdf/pdfx4.js`) support multi-page compilation:
- **Shared Document Catalog (`/Root`)**: References the root `/Pages` node and OutputIntent dictionary (`/GTS_PDFX`).
- **`/Pages` Tree**: Aggregates all indirect page references (`/Kids [1 0 R, 2 0 R, ...]`) with exact total `/Count`.
- **Per-Page Geometry**:
  - Independent `/MediaBox`, `/BleedBox`, and `/TrimBox` arrays per page record.
  - Page-specific content stream scaling to match exact points dimensions.
  - Unique Image XObject references (`/Im1`, `/Im2`, ...).
- **PDF/X Compliance**:
  - PDF/X-1a embeds certified DeviceCMYK ICC output profile and disallows live transparency.
  - PDF/X-4 embeds output condition (e.g., FOGRA39) and includes page-level `/Group << /Type /Group /S /Transparency /CS /DeviceCMYK >>` dictionaries.

---

## 4. Document Page Splitting & Page Range Filtering

Poltergeist allows splitting multi-page publications into independent, single-page print files and proofs with zero layout degradation:

### Configuration Options
- `splitPages: true`: Splits multi-page inputs (PDF, IDML, DOCX, CBZ, etc.) into individual files (`page_1.pdf`, `page_2.pdf`, etc.).
- `page: n`: (1-indexed integer) Extracts a single page from the input document. Returns a single `Uint8Array` when `splitPages` and `renderProofs` are false.
- `pages: [n1, n2, ...]`: (1-indexed integer array) Extracts an arbitrary subset of pages.
- `pageNaming: (pageNum, page) => string`: Optional callback to customize page file naming (e.g. `(n) => \`issue_p\${String(n).padStart(3, '0')}\``).

### Error Handling & Memory Safety (Rule 6 & Rule 15)
- Throws `RangeError` with descriptive diagnostics if `page` or any element of `pages` is out of bounds (`p < 1 || p > document.pages.length`) or non-integer.
- Early page filtering ensures unselected pages are discarded prior to expensive color conversion or resampling, bounding memory usage.

---

## 5. Dual Output & Screen / Master Proofing Architecture

Prepress operations frequently require simultaneous generation of high-resolution press targets alongside low-resolution or master digital proofs for customer review:

### Dual-Pass Proof Generation
- `renderProofs: true`: Enables proof generation alongside the main output.
- `proofDpi`: Target resolution for proofs:
  - Single numeric DPI: `72` (web proof), `300` (master proof), `600`, `1200`.
  - Native extraction: `'native'`, `'source'`, `'original'` (retains exact source raster dimensions without resampling).
  - Multi-tier array: `[72, 300]` generates both screen proofs (`page_1_72dpi.jpg`) and master proofs (`page_1_300dpi.jpg`).
- `proofFormat`: `'jpeg'` (standard RGB proof) or `'tiff'` (lossless uncompressed/Deflate TIFF).
- `proofQuality`: JPEG quality compression factor (1-100, default 85).

### Color Integrity in Proofs
When converting documents to CMYK print targets (such as PDF/X-1a), Poltergeist preserves the pre-conversion sRGB buffers for proof generation, eliminating lossy CMYK-to-RGB round-trips and preserving vibrant RGB display colors.

---

## 6. High-Resolution & True-Resolution Manga Screentone Preservation

Commercial manga and comics production relies heavily on 600 DPI to 1200 DPI 1-bit/8-bit halftone screentones (typically 60 to 100 LPI dot patterns). Standard prepress downsamplers automatically resample images over 450 DPI down to 300 DPI, causing catastrophic Moiré interference patterns:

### Bypass Downsampling
- `bypassDownsampling: true` (or `preserveResolution: true`, or `downsample: false`): Completely bypasses bicubic/Lanczos threshold downsampling.
- Source line art and bitmap screentones at 600 DPI or 1200 DPI are preserved with 100% pixel-for-pixel fidelity.

### Lossless TIFF Proofs
- When proofing manga screentones, setting `proofFormat: 'tiff'` and `proofDpi: 'native'` produces lossless Deflate-compressed TIFF proofs.
- This eliminates JPEG Discrete Cosine Transform (DCT) ringing and mosquito noise around high-frequency halftone dots and razor-sharp line art.

---

## 7. Multi-Core Worker Pool & Lazy Image Ingestion (`convertParallel`)

Large multi-page publications (such as 28-page high-resolution catalogs or 300-page magazines) require scalable concurrency without main-thread blocking or heap exhaustion:

### Lazy Image Ingestion & Zero-Block Decoding
- **Deferred Image Extraction**: The PDF parser records the compressed DCT stream (`page.rawImageStream`) during structure ingestion rather than eagerly decompressing all images on the main thread.
- **Microsecond Ingestion Latency**: Parsing a 28-page, 33 MB document finishes in under 15 ms on the main thread.
- **Worker-Side Execution**: Compressed streams are dispatched across isolated worker threads (`convert_worker.js`) in a persistent `WorkerPool`. Image decoding, bicubic downsampling, ICC-calibrated RGB to CMYK conversion, and Deflate stream compression occur concurrently across all CPU cores.

### Execution Modes
- **Mode A (Split Pages / Proofs / Multi-JPEG)**: Each worker processes a page and serializes the finished file (`.jpg`, `.pdf`, `.tif`). Results are aggregated into a `Map<string, Uint8Array>`.
- **Mode B (Multi-Page Master PDF/X-1a)**: Workers perform heavy color transforms and downsampling in parallel, returning processed `PageRecord` objects to the master assembler for single-pass stream generation.
