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
