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
    $$\mathbf{CP}_1 = \mathbf{P}_0 + \frac{2}{3}(\mathbf{P}_{\text{control}} - \mathbf{P}_0), \quad \mathbf{CP}_2 = \mathbf{P}_1 + \frac{2}{3}(\mathbf{P}_{\text{control}} - \mathbf{P}_1)$$
  - Smooth Curves (`S`, `s` and `T`, `t`): Control points are mirrored across current point:
    $$\mathbf{CP}_1 = 2\mathbf{P}_{\text{current}} - \mathbf{CP}_{\text{previous}}$$
- **Basic Shape Translation**:
  - `<rect>` $\to$ 4-point closed path.
  - `<circle>` and `<ellipse>` $\to$ 4-segment cubic Bézier spline with circular constant $k = 0.5522847498$.
  - `<line>`, `<polyline>`, `<polygon>` $\to$ linear path sequence.

---

## 4. AutoCAD Architectural Model-to-Paper Projection

AutoCAD schematics are typically modeled in real-world units (e.g., millimeters, meters, inches, or feet) with arbitrary coordinate extents. `DxfDecoder` performs automated coordinate projection onto standardized commercial print architectural sheets:

1. **Model Extents Calculation**:
   $$X_{\min}, Y_{\min}, X_{\max}, Y_{\max} \implies W_{\text{model}} = X_{\max} - X_{\min}, \quad H_{\text{model}} = Y_{\max} - Y_{\min}$$
2. **Sheet Dimensions**:
   - `ARCH_D`: $36 \times 24\text{ in} \implies 2592 \times 1728\text{ pt}$.
   - `ARCH_E`: $48 \times 36\text{ in} \implies 3456 \times 2592\text{ pt}$.
   - `ISO_A1`: $841 \times 594\text{ mm} \implies 2384 \times 1684\text{ pt}$.
   - `ISO_A0`: $1189 \times 841\text{ mm} \implies 3370 \times 2384\text{ pt}$.
3. **Aspect-Preserving Centered Scale**:
   $$\text{scale} = \min\left(\frac{W_{\text{sheet}} - 2 \cdot \text{margin}}{W_{\text{model}}}, \frac{H_{\text{sheet}} - 2 \cdot \text{margin}}{H_{\text{model}}}\right)$$
4. **ACI Color Mapping**:
   AutoCAD Color Index 1 through 7 mapped to standardized RGB primaries (`1=Red, 2=Yellow, 3=Green, 4=Cyan, 5=Blue, 6=Magenta, 7=Black/White`).
