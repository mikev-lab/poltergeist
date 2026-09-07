# Vector Graphics & CAD Schematic Ingestion Specification

## 1. Architectural Purpose

**Poltergeist** provides pure native ingestion and normalization for scalable vector artwork and architectural/engineering schematics. Vector primitives are parsed directly into native `VectorPath` objects, preserving path geometry (straight lines, quadratic and cubic Béziers) and emitting standard PDF path operators without lossy rasterization.

---

## 2. Supported Vector & CAD Formats

| Format | Extension | Container / Syntax | Primary Parser | Key Prepress Capability |
| :--- | :--- | :--- | :--- | :--- |
| **Scalable Vector Graphics** | `.svg` | XML DOM / Text | `SvgDecoder` | `viewBox` scaling, full Bézier path tokens (`M, L, C, S, Q, T, A, Z`), shape normalization. |
| **Adobe Illustrator** | `.ai` | PDF Stream / PostScript | `AiDecoder` | Dual-stream parsing: modern PDF stream extraction (v9+) and legacy PostScript DSC parsing. |
| **CorelDRAW** | `.cdr` | ZIP Package / RIFF | `CdrDecoder` | vX4+ ZIP container extraction, embedded SVG/XML retrieval, legacy RIFF chunk parsing. |
| **Windows Metafile** | `.wmf`, `.emf` | Binary GDI Records | `WmfDecoder` | APM placeable headers, 16-bit/32-bit GDI coordinate scaling to PDF 72 DPI points. |
| **AutoCAD DXF** | `.dxf` | ASCII Group-Codes | `DxfDecoder` | Group 0/10/20 entity tokenization (`LINE`, `CIRCLE`, `LWPOLYLINE`), ACI color table, sheet projection. |
| **AutoCAD DWG** | `.dwg` | Binary Header / AC10xx | `DwgDecoder` | Header version sniffing (`AC1015`–`AC1032`), maintenance version, preview thumbnail extraction. |

---

## 3. SVG Path Tokenization & Shape Expansion

SVG path strings (`d="..."`) are parsed through a linear state-machine tokenizer into `PathCommand` sequences:
- **Relative to Absolute Conversion**: Relative coordinates (`m, l, c, s, q, t, a`) maintain running current coordinates `(curX, curY)`.
- **Higher-Order Curve Normalization**:
  - Quadratic Béziers (`Q`, `q`, `T`, `t`) are mathematically elevated to cubic Béziers:
    ```text
CP1 = P0 + (2/3) × (Pcontrol - P0)
CP2 = P1 + (2/3) × (Pcontrol - P1)
```
  - Smooth Curves (`S`, `s` and `T`, `t`): Control points are mirrored across current point:
    ```text
CP1 = 2 × P_current - CP_previous
```
- **Basic Shape Translation**:
  - `<rect>` → 4-point closed path.
  - `<circle>` and `<ellipse>` → 4-segment cubic Bézier spline with circular constant k = 0.5522847498.
  - `<line>`, `<polyline>`, `<polygon>` → linear path sequence.

---

## 4. AutoCAD Architectural Model-to-Paper Projection

AutoCAD schematics are typically modeled in real-world units (e.g., millimeters, meters, inches, or feet) with arbitrary coordinate extents. `DxfDecoder` performs automated coordinate projection onto standardized commercial print architectural sheets:

1. **Model Extents Calculation**:
   ```text
Bounding Extents:
X_min, Y_min, X_max, Y_max
W_model = X_max - X_min,  H_model = Y_max - Y_min
```
2. **Sheet Dimensions**:
   - `ARCH_D`: 36 × 24 in → 2592 × 1728 pt.
   - `ARCH_E`: 48 × 36 in → 3456 × 2592 pt.
   - `ISO_A1`: 841 × 594 mm → 2384 × 1684 pt.
   - `ISO_A0`: 1189 × 841 mm → 3370 × 2384 pt.
3. **Aspect-Preserving Centered Scale**:
   ```text
scale = min((W_sheet - 2 × margin) / W_model, (H_sheet - 2 × margin) / H_model)
```
4. **ACI Color Mapping**:
   AutoCAD Color Index 1 through 7 mapped to standardized RGB primaries (`1=Red, 2=Yellow, 3=Green, 4=Cyan, 5=Blue, 6=Magenta, 7=Black/White`).
