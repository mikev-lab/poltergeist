# Layered Graphics Binary Specifications (`layered-graphics.md`)

This document specifies the internal binary structure and zero-dependency ingestion pipelines for complex layered graphic formats in **Poltergeist**: Adobe Photoshop (`.psd`, `.psb`), Clip Studio Paint (`.clip`), and GIMP (`.xcf`).

---

## 1. Adobe Photoshop PSD and PSB (`src/ingestion/layered/psd/`)

Adobe Photoshop documents use a proprietary binary container format consisting of five sequential sections:
1. **Header** (26 bytes fixed)
2. **Color Mode Data**
3. **Image Resources** (`8BIM` blocks)
4. **Layer and Mask Information**
5. **Composite Image Data**

### 1.1 Header Specification
- **Magic**: `8BPS` (`0x38, 0x42, 0x50, 0x53`).
- **Version**:
  - `1`: Standard Photoshop PSD (maximum dimensions: 30,000 × 30,000 px). 32-bit channel and section lengths.
  - `2`: Photoshop Large Document Format PSB (maximum dimensions: 300,000 × 300,000 px). 64-bit channel and section lengths.
- **Channels**: 1 to 56.
- **Bit Depth**: 1, 8, 16, or 32 bits per channel.
- **Color Mode**: Bitmap (0), Grayscale (1), Indexed (2), RGB (3), CMYK (4), Multi-channel (7), Duotone (8), Lab (9).

### 1.2 Image Resources (`8BIM`)
- `0x03ED` (`ResolutionInfo`): Contains horizontal and vertical print DPI (stored as 16.16 signed fixed-point) and unit indicators.
- `0x040F` (`ICC Profile`): Embedded raw ICC profile buffer applied directly to color transformation.

### 1.3 Layer & Mask Information
- **Layer Count**: 16-bit signed integer. If negative, absolute value represents layer count and first alpha channel contains transparency.
- **Layer Records**:
  - Bounding box coordinates:
    - PSD (v1): `top`, `left`, `bottom`, `right` (int32 BE, 16 bytes).
    - PSB (v2): `top`, `left`, `bottom`, `right` (int64 BE, 32 bytes).
  - Number of channels (uint16).
  - Channel info entries: channel ID (int16: 0=R/C, 1=G/M, 2=B/Y, 3=K, -1=transparency mask, -2=user layer mask) + length (uint32 in PSD, uint64 in PSB).
  - Blend mode signature: `8BIM`.
  - Blend key: 4-character ASCII code (`norm`, `mul `, `scrn`, `over`, `dark`, `lite`, `div `, `idiv`, `hLit`, `sLit`, `diff`, `smud`).
  - Opacity: 1 byte (0 ... 255).
  - Clipping flag: 1 byte (0 = base, 1 = clip).
  - Flags: bit 1 (0 = visible, 1 = hidden).
- **Channel Compression**:
  - `0`: Raw uncompressed bytes.
  - `1`: PackBits RLE (2-byte scanline byte count table in PSD, 4-byte table in PSB).
  - `2`: Deflate ZIP without prediction.
  - `3`: Deflate ZIP with horizontal difference prediction.

---

## 2. Clip Studio Paint `.clip` Ingestion (`src/ingestion/layered/clip/`)

Clip Studio Paint (`.clip`) files are SQLite 3 relational database files containing proprietary tables. To uphold Poltergeist's **Rule 7 (Zero External Runtime Dependencies)**, Poltergeist incorporates a pure native, memory-safe SQLite 3 B-Tree reader.

### 2.1 Native SQLite B-Tree Reader Architecture (`sqlite_reader.js`)
- **100-byte Database Header**: Validates magic string `SQLite format 3\0`, page size (512 ≤ pageSize ≤ 65536), and file change counters.
- **Page Traversal**:
  - `0x0D`: Table B-Tree Leaf Page. Reads cell pointers array, extracts row varints, and decodes record payloads.
  - `0x05`: Table B-Tree Interior Page. Traverses left and right child page pointers.
- **Varint Decoding**: Reads 1 to 9-byte SQLite variable integers.
- **Payload Deserializer**: Handles NULL (0), 8-bit to 64-bit signed integers (1–6), IEEE 754 float64 (7), 0/1 constants (8, 9), BLOBs (even serial types ≥ 12), and UTF-8 strings (odd serial types ≥ 13).
- **Catalog Navigation**: Parses `sqlite_master` on Page 1 to locate root pages for target tables.

### 2.2 Table Schemas
- `Canvas`: Extracts document width, height, and print resolution (DPI).
- `CanvasPreview`: Contains rendered composite image stream (PNG or JPEG).
- `Layer`: Extracts layer hierarchy, names, opacities, and folder grouping.
- `LayerParam`: Extracts blend modes and clipping mask flags.

---

## 3. GIMP XCF Ingestion (`src/ingestion/layered/xcf/`)

GIMP native format (`.xcf`) structure:
- **Magic**: `gimp xcf ` followed by version string (e.g. `v001\0`, `v002\0`, etc.).
- **Canvas Dimensions & Base Color Space**: width (uint32), height (uint32), baseType (0 = RGB, 1 = Grayscale, 2 = Indexed).
- **Properties List**: Terminated by `PROP_END` (0).
  - `PROP_RESOLUTION` (18): 32-bit floating point X and Y resolution.
- **Layer Offset Directory**: Array of 32-bit offsets pointing to layer records.
- **Layer Record**: Dimensions, type, layer name, and layer properties (`PROP_OPACITY`, `PROP_VISIBLE`, `PROP_OFFSETS`, `PROP_MODE`).
