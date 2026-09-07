# Poltergeist Documentation

Welcome to the **Poltergeist** technical documentation. Poltergeist is a memory-safe, zero-dependency file handling and prepress conversion suite designed to replace Ghostscript in mission-critical publishing, digital proofing, and commercial print production.

---

## Documentation Directory

### 1. Architecture & Core Pipelines
- **[System Architecture & Overview](architecture/system-overview.md)**: High-level architectural layers, unidirectional flow, pipeline topology, and memory safety principles.
- **[Exhaustive Architecture](architecture/exhaustive-architecture.md)**: Detailed system specifications, chunked memory streaming models, and subsystem interfaces.
- **[Engineering Roadmap](architecture/roadmap.md)**: Six-phase engineering milestones, deliverables, and completion status.
- **[Color Separation & Prepress Pipeline](pipelines/color-pipeline.md)**: ICC v2/v4 parsing, 3D LUT tetrahedral interpolation, Total Area Coverage (TAC) ink limiting via UCR/GCR, DeviceN spot colors, and overprint simulation (`-dSimulateOverprint`).
- **[Transparency Flattening & Font Outlining](pipelines/transparency-and-fonts.md)**: PDF/X-1a atomic region decomposition, sub-tile contone rasterization, and TrueType/OpenType glyph outline decompilation.
- **[Document Streaming Pipeline](pipelines/document-stream-pipeline.md)**: 1:1 sequential multi-page assembler with bounded O(page) memory consumption.

---

### 2. Universal File Ingestion Specifications
- **[Supported File Types](formats/supported-file-types.md)**: Complete binary format support matrix, magic byte signatures, and normalization targets.
- **[Layered Graphics](formats/layered-graphics.md)**: Adobe Photoshop (`.psd`, `.psb`), Clip Studio Paint (`.clip` with pure SQLite 3 B-Tree engine), and GIMP (`.xcf`).
- **[Office & Document Layouts](formats/document-layouts.md)**: Adobe InDesign IDML packages, Microsoft Office OpenXML (`.docx`, `.xlsx`, `.pptx`), Legacy OLE2 CFBF (`.doc`, `.xls`, `.ppt`, `.pub`, `.vsd`), Apple iWork, OpenDocument (ODF), PostScript/EPS, and OpenXPS.
- **[Camera RAW & Digital Negatives](formats/camera-raw.md)**: Adobe DNG, Canon CR2, Nikon NEF, Sony ARW, Olympus ORF, Fujifilm RAF, Minolta MRW, Sigma X3F, and Bayer CFA demosaicing.
- **[Vector & CAD Graphics](formats/vector-and-cad.md)**: SVG, Adobe Illustrator (AI), CorelDRAW (CDR), Windows Metafile (WMF/EMF), and AutoCAD DXF/DWG.
- **[Digital Publications & Comics](formats/digital-publications.md)**: Comic book archives (`.cbz`, `.cbr`) with natural page ordering, and EPUB publications.

---

### 3. Benchmarks, Testing & Ghostscript Parity
- **[Performance Benchmarks](testing/benchmarks.md)**: Throughput benchmarks in Megapixels per second (MP/s) and Megabytes per second (MB/s), latency percentiles, and regression budgets.
- **[Ghostscript Parity Matrix](testing/ghostscript-parity-matrix.md)**: Feature-by-feature mapping of Ghostscript switches (`-sDEVICE=pdfwrite`, `-sDEVICE=tiffsep`, `-dSimulateOverprint`, `-dColorConversionStrategy=/DeviceCMYK`) and security CVE mitigations.
- **[Testing & Quality Guide](testing/review-and-testing-guide.md)**: Zero-untested code policy, golden path vs. deep edge case requirements, and fuzz testing protocols.
