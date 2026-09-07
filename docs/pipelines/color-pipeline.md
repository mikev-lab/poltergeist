# Poltergeist Color Separation & Prepress Pipeline

## 1. Overview

The Poltergeist Color Pipeline handles the conversion of raster imagery from additive RGB color spaces (sRGB, Adobe RGB 1998, Display P3) to subtractive CMYK color spaces (e.g. GRACoL 2006, SWOP 2006 Coated, ISO Coated v2) required by commercial prepress offset and digital presses.

Unlike simplistic heuristic conversions ((C = 1 - R, M = 1 - G, Y = 1 - B, K = min(C, M, Y))) which yield muddy, desaturated, and unprintable results, Poltergeist utilizes an ICC-calibrated transformation engine paired with prepress ink limiting algorithms.

---

## 2. Transformation Pipeline Stages

```text
[Input RGB: 8/16-bit]
        │
        ▼
1. Inverse EOTF (Linearization)
        │
        ▼
2. Source ICC Transform (RGB -> CIEXYZ / CIELAB Connection Space)
        │
        ▼
3. Rendering Intent Mapping (Perceptual / Relative Colorimetric / Saturation)
        │
        ▼
4. Target ICC Transform (CIEXYZ / CIELAB -> Device CMYK)
        │
        ▼
5. Prepress TAC (Total Area Coverage) Evaluation & UCR/GCR Correction
        │
        ▼
[Output CMYK: 8/16-bit Print Ready Buffer]
```

### Stage 1: Linearization & Tone Reproduction Curve (TRC)
- Source pixel color channels are transformed via the Tone Reproduction Curve (either parametric curve types 0–4 or sampled 1D LUTs) from encoded non-linear values to linear optical intensity.

### Stage 2 & 4: Profile Connection Space (PCS) & Multidimensional LUTs
- The PCS operates in either 16-bit CIEXYZ or CIELAB.
- For LUT-based profiles (`mft1`, `mft2`, `mABType`, `mBAType`):
  - Input curves (1D) → Matrix (if XYZ) → Multidimensional CLUT (3D grid: e.g., 33 × 33 × 33) → Output curves (1D).
  - Interpolation within the 3D CLUT is executed via **tetrahedral interpolation**, which reduces color banding and preserves tonal smoothness compared to trilinear interpolation.

### Stage 3: Rendering Intents
Poltergeist supports standard ICC rendering intents:
- **Relative Colorimetric (Default)**: Maps white point of source to white point of destination; in-gamut colors are accurately preserved.
- **Perceptual**: Compresses the entire source gamut into the target prepress gamut, preserving visual relationships between colors at the expense of absolute accuracy.
- **Absolute Colorimetric**: Preserves exact coordinates including paper white, used for contract proofing simulation.

---

## 3. Prepress Total Area Coverage (TAC) Enforcement

### 3.1 The TAC Problem
Commercial offset lithography and high-speed digital web presses place physical limits on wet ink density. The sum of all four ink percentages:
```text
TAC = C% + M% + Y% + K%
```
Excessive TAC (>300–340% depending on paper stock) causes ink offsetting, sheet sticking, paper curling, long drying times, and press jams.

| Paper / Standard | Common Specification | Maximum Safe TAC |
| :--- | :--- | :--- |
| **GRACoL 2006 / 2013** | Sheetfed commercial coated paper | 320% |
| **SWOP 2006 Coated** | Web publication coated paper | 300% |
| **ISO Coated v2 (FOGRA39)** | European sheetfed commercial | 330% |
| **Uncoated / Newsprint** | High absorption substrates | 240% - 280% |

### 3.2 UCR / GCR Algorithm Invariant
When a pixel's combined ink sum exceeds the configured target limit (TAC_actual > TAC_limit):
1. **Delta Calculation**:
   ```text
Δ_excess = (C + M + Y + K) - TAC_limit
```
2. **Gray Component Replacement (GCR)**:
   - Identify the minimum chromatic component:
     ```text
M_neutral = min(C, M, Y)
```
   - Calculate replaceable neutral density and shift ink mass from the three expensive chromatic plates (C, M, Y) to the Black (K) plate.
3. **Under Color Removal (UCR)**:
   - In deep shadow regions where K is already near saturation (K → 100%), subtract proportionally from C, M, Y maintaining chromatic ratios to avoid color tinting:
     ```text
C' = C - (Δ_excess × C / (C + M + Y))
M' = M - (Δ_excess × M / (C + M + Y))
Y' = Y - (Δ_excess × Y / (C + M + Y))
```
     
4. **Validation**:
   - Assert C' + M' + Y' + K' ≤ TAC_limit.
   - Assert hue angle Δhab remains below 0.5°.

---

## 4. Color Metric Tolerances (Delta E)

Every color separation implementation must be validated against reference conversions using the **CIEDE2000 (ΔE00)** color difference formula:
```text
ΔE00 ≤ 1.0 (Imperceptible to standard human eye)
```
Color separations yielding ΔE00 > 1.5 fail automated test assertions.

---

## 5. Spot Color & DeviceN Subsystem

Prepress workflows frequently incorporate specialized non-process inks:
- **DeviceN & Separation Color Spaces**: Evaluates named spot colors (e.g. `PANTONE 185 C`, `PANTONE Reflex Blue C`, `Metallic Gold`, `Spot White`, `Varnish`, `CutContour`).
- **TintTransform Evaluation**:
  When outputting to 4-color CMYK presses, Poltergeist evaluates the profile TintTransform function (sampled 1D functions or PostScript calculator functions) to calculate process CMYK equivalents:
  ```text
f_tint: [0.0, 1.0] → [C, M, Y, K]
```
- **Plate Channel Isolation**: When targeting discrete platesetter files (`tiffsep`), spot colors bypass CMYK transformation and are preserved as discrete grayscale 8-bit or 1-bit separation bitmaps.

---

## 6. Overprint Simulation Engine (`-dSimulateOverprint`)

In physical offset printing, inks set to "Overprint" (`/OP true`, `/op true`) do not knock out the underlying colors on lower plates:
- **Subtractive Ink Mixing Simulation**:
  When Overprint Mode (OPM = 1) is active in PDF graphics states, foreground ink channels overlay background channels subtractively rather than replacing them:
  ```text
C_final = C_fg  (if foreground defines C)
C_final = C_bg  (if foreground does not define C - overprint)
```
- **Soft Proof Rendering**: Overprint simulation allows digital proofing JPEGs and TIFFs to visually display the true composite appearance of overprinting black text and spot varnish elements as they will appear on press.

---

## 7. High-Throughput DeviceLink 3D CLUT Buffer Acceleration

To eliminate the overhead of per-pixel object allocation (`new RgbColor`, `new CmykColor`) and redundant matrix/TRC evaluations when transforming multi-megapixel images and multi-page publications, Poltergeist employs a zero-allocation **DeviceLink 3D CLUT** acceleration architecture:

### 7.1 Baked DeviceLink 3D Grid (33 × 33 × 33)
- **Precomputed Grid**: A 33 × 33 × 33 uniform RGB cube ($35,937$ nodes, $143,748$ bytes) is lazily evaluated once per transform configuration ($R, G, B \in [0.0, 1.0]$).
- **Embedded TAC Limiting**: During CLUT generation, `TacLimiter.limit(cmyk)` is evaluated at each node, baking Total Area Coverage constraints (e.g. 300% SWOP, 320% GRACoL) directly into the CLUT. This completely removes TAC calculation from the inner raster loops.
- **Generation Overhead**: CLUT computation completes in ~20 ms and is cached on the `ColorTransform` instance across all pages in a document.

### 7.2 Zero-Allocation 3D Tetrahedral Interpolation (`transformRgbBufferToCmykBuffer`)
- Transforms interleaved RGB/RGBA `Uint8Array` directly to interleaved CMYK `Uint8Array` in place.
- Direct typed-array pointer arithmetic evaluates the 6 tetrahedral simplices using normalized fractional weights ($dx, dy, dz$), preserving smooth continuous tones and preventing color banding.
- **Throughput**: Reaches **100+ Megapixels per second (287+ MB/s)** in pure native JavaScript, processing an 8.75 Megapixel 300 DPI illustration in ~87–110 ms.

### 7.3 Grayscale 1D LUT Expansion (`transformGrayBufferToCmykBuffer`)
- For 1-channel Grayscale inputs, a 256-entry 1D lookup table ($1,024$ bytes) maps every possible 8-bit gray level to process CMYK + TAC.
- **Throughput**: > **300 Megapixels per second** with exact 0.0 channel error against analytical scalar evaluation.

