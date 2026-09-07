# Poltergeist Color Separation & Prepress Pipeline

## 1. Overview

The Poltergeist Color Pipeline handles the conversion of raster imagery from additive RGB color spaces (sRGB, Adobe RGB 1998, Display P3) to subtractive CMYK color spaces (e.g. GRACoL 2006, SWOP 2006 Coated, ISO Coated v2) required by commercial prepress offset and digital presses.

Unlike simplistic heuristic conversions ($C = 1 - R, M = 1 - G, Y = 1 - B, K = \min(C, M, Y)$) which yield muddy, desaturated, and unprintable results, Poltergeist utilizes an ICC-calibrated transformation engine paired with prepress ink limiting algorithms.

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
  - Input curves (1D) $\to$ Matrix (if XYZ) $\to$ Multidimensional CLUT (3D grid: e.g., $33 \times 33 \times 33$) $\to$ Output curves (1D).
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
$$\text{TAC} = C\% + M\% + Y\% + K\%$$
Excessive TAC (>300–340% depending on paper stock) causes ink offsetting, sheet sticking, paper curling, long drying times, and press jams.

| Paper / Standard | Common Specification | Maximum Safe TAC |
| :--- | :--- | :--- |
| **GRACoL 2006 / 2013** | Sheetfed commercial coated paper | $320\%$ |
| **SWOP 2006 Coated** | Web publication coated paper | $300\%$ |
| **ISO Coated v2 (FOGRA39)** | European sheetfed commercial | $330\%$ |
| **Uncoated / Newsprint** | High absorption substrates | $240\% - 280\%$ |

### 3.2 UCR / GCR Algorithm Invariant
When a pixel's combined ink sum exceeds the configured target limit ($\text{TAC}_{\text{actual}} > \text{TAC}_{\text{limit}}$):
1. **Delta Calculation**:
   $$\Delta_{\text{excess}} = (C + M + Y + K) - \text{TAC}_{\text{limit}}$$
2. **Gray Component Replacement (GCR)**:
   - Identify the minimum chromatic component:
     $$M_{\text{neutral}} = \min(C, M, Y)$$
   - Calculate replaceable neutral density and shift ink mass from the three expensive chromatic plates ($C, M, Y$) to the Black ($K$) plate.
3. **Under Color Removal (UCR)**:
   - In deep shadow regions where $K$ is already near saturation ($K \to 100\%$), subtract proportionally from $C, M, Y$ maintaining chromatic ratios to avoid color tinting:
     $$C' = C - \left(\Delta_{\text{excess}} \times \frac{C}{C + M + Y}\right)$$
     $$M' = M - \left(\Delta_{\text{excess}} \times \frac{M}{C + M + Y}\right)$$
     $$Y' = Y - \left(\Delta_{\text{excess}} \times \frac{Y}{C + M + Y}\right)$$
4. **Validation**:
   - Assert $C' + M' + Y' + K' \le \text{TAC}_{\text{limit}}$.
   - Assert hue angle $\Delta h_{ab}$ remains below $0.5^\circ$.

---

## 4. Color Metric Tolerances (Delta E)

Every color separation implementation must be validated against reference conversions using the **CIEDE2000 ($\Delta E_{00}$)** color difference formula:
$$\Delta E_{00} \le 1.0 \quad (\text{Imperceptible to standard human eye})$$
Color separations yielding $\Delta E_{00} > 1.5$ fail automated test assertions.

---

## 5. Spot Color & DeviceN Subsystem

Prepress workflows frequently incorporate specialized non-process inks:
- **DeviceN & Separation Color Spaces**: Evaluates named spot colors (e.g. `PANTONE 185 C`, `PANTONE Reflex Blue C`, `Metallic Gold`, `Spot White`, `Varnish`, `CutContour`).
- **TintTransform Evaluation**:
  When outputting to 4-color CMYK presses, Poltergeist evaluates the profile TintTransform function (sampled 1D functions or PostScript calculator functions) to calculate process CMYK equivalents:
  $$f_{\text{tint}}: [0.0, 1.0] \to [C, M, Y, K]$$
- **Plate Channel Isolation**: When targeting discrete platesetter files (`tiffsep`), spot colors bypass CMYK transformation and are preserved as discrete grayscale 8-bit or 1-bit separation bitmaps.

---

## 6. Overprint Simulation Engine (`-dSimulateOverprint`)

In physical offset printing, inks set to "Overprint" (`/OP true`, `/op true`) do not knock out the underlying colors on lower plates:
- **Subtractive Ink Mixing Simulation**:
  When Overprint Mode ($OPM = 1$) is active in PDF graphics states, foreground ink channels overlay background channels subtractively rather than replacing them:
  $$C_{\text{final}} = \begin{cases} C_{\text{fg}} & \text{if foreground defines } C \\ C_{\text{bg}} & \text{if foreground channel is unset or transparent} \end{cases}$$
- **Soft Proof Rendering**: Overprint simulation allows digital proofing JPEGs and TIFFs to visually display the true composite appearance of overprinting black text and spot varnish elements as they will appear on press.

