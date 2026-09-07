# Digital Publications & Comics Ingestion Specification

## 1. Overview & Operational Mandate

**Poltergeist** provides pure native ingestion for digital publications and serialized graphic novels. This subsystem extracts multi-page reading sequences, preserves natural page sorting, handles double-page landscape spreads, and compiles publication assets into certified prepress export streams.

---

## 2. Supported Formats & Archive Signatures

| Format | Extension | Container Structure | Packaging Standard | Primary Decoder |
| :--- | :--- | :--- | :--- | :--- |
| **Comic Book ZIP** | `.cbz` | ZIP Archive | Open Comic Book Archive | `ComicDecoder` |
| **Comic Book RAR** | `.cbr` | RAR Archive (`Rar!\x1A\x07`) | Legacy RAR Archive | `ComicDecoder` |
| **Electronic Publication** | `.epub` | OCF Container (`mimetype`) | IDPF / W3C EPUB 3.x | `EpubDecoder` |

---

## 3. Comic Book Archive Sequencing & Spread Detection

### 3.1 Natural Alphanumeric Page Sorting
Lexicographical string sorting in naive decoders corrupts comic reading order:
```text
Lexical Order:  Page_1.png → Page_10.png → Page_2.png  (Incorrect)
```
Poltergeist enforces natural numeric collation via locale-aware integer parsing:
```text
Natural Order:  Page_1.png → Page_2.png  → Page_10.png (Preserved)
```

### 3.2 Double-Page Spread Detection
Comic artists regularly compose two-page horizontal splash spreads. For every decoded raster page, the aspect ratio is evaluated:
```text
aspectRatio = width / height
```
- If aspectRatio > 1.2, the page is flagged with `isSpread: true` and mapped to landscape media box geometry.
- If aspectRatio ≤ 1.2, the page is treated as standard portrait orientation.

### 3.3 ComicInfo.xml Metadata Extraction
If an internal `ComicInfo.xml` schema is present in the archive root, Dublin Core and comic metadata are parsed:
- `<Series>` and `<Title>` mapped to `Document.title`.
- `<Writer>`, `<Penciller>`, and `<Publisher>` preserved in document metadata.

---

## 4. EPUB Open Container Format (OCF) & Spine Architecture

1. **Rootfile Discovery**:
   The decoder reads `META-INF/container.xml` to locate the active Open Packaging Format (`.opf`) manifest file.
2. **Spine Reading Order**:
   The `<spine>` element defines the canonical reading sequence via `<itemref idref="...">`. Chapters are assembled sequentially regardless of filesystem directory sorting.
3. **Chapter Content Compilation**:
   - XHTML chapters are stripped of markup and parsed into bounded text streams for document indexing and print flow.
   - Embedded cover and illustration graphics are extracted and formatted into native `PageRecord` instances with exact physical dimensions.
