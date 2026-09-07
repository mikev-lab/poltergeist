# Transparency Flattening & Font Outlining Pipeline (`transparency-and-fonts.md`)

This document details the multi-layer compositing math, separable blend mode equations, PDF/X-1a transparency flattening engine, and font outline decompilation pipeline in **Poltergeist**.

---

## 1. Multi-Layer Compositing & Blend Modes (`src/compositor/blend/`)

### 1.1 Porter-Duff Alpha Math
For arbitrary source (S) and backdrop (B) samples with respective opacities α_s and α_b, the resulting alpha α_r and color C_r under Source Over are:
```text
α_r = α_s + α_b × (1 - α_s)
```
```text
C_r = (C_s × α_s + C_b × α_b × (1 - α_s)) / α_r
```

### 1.2 Separable Blend Mode Equations (ISO 32000 & Adobe Photoshop)
When a separable blend mode `B(Cb, Cs)` is active with non-unity alphas:
```text
C_r = ((1 - α_b) × α_s × C_s + (1 - α_s) × α_b × C_b + α_s × α_b × B(C_b, C_s)) / α_r
```

Supported mathematical blend functions:
- **Multiply**: `B(Cb, Cs) = Cb × Cs`
- **Screen**: `B(Cb, Cs) = Cb + Cs - Cb × Cs`
- **Overlay**:
  ```text
Overlay / Hard Light Formula:
If Cb ≤ 0.5: 2 × Cb × Cs
Otherwise:   1 - 2 × (1 - Cb) × (1 - Cs)
```
- **Hard Light**:
  ```text
Overlay / Hard Light Formula:
If Cb ≤ 0.5: 2 × Cb × Cs
Otherwise:   1 - 2 × (1 - Cb) × (1 - Cs)
```
- **Darken**: `B(Cb, Cs) = min(Cb, Cs)`
- **Lighten**: `B(Cb, Cs) = max(Cb, Cs)`
- **Difference**: `B(Cb, Cs) = |Cb - Cs|`
- **Exclusion**: `B(Cb, Cs) = Cb + Cs - 2 × Cb × Cs`
- **Color Dodge**: `B(Cb, Cs) = min(1, Cb / (1 - Cs))`
- **Color Burn**: `B(Cb, Cs) = 1 - min(1, (1 - Cb) / Cs)`

### 1.3 Clipping Mask Modulations
When a layer has `clipping = true`, its effective alpha at coordinate (x, y) is modulated by the base layer's alpha plane:
```text
α_clipped(x, y) = α_layer(x, y) × α_base(x, y)
```
This ensures clipped graphics only appear inside non-zero pixels of the base artwork.

---

## 2. PDF/X-1a Transparency Flattener (`src/compositor/flattener/`)

ISO 15930-1 (PDF/X-1a:2001) strictly forbids live transparency dictionaries (`/Group << /S /Transparency >>`, `/SMask`, `/BM` other than `/Normal`, `/ca` or `/CA < 1.0`).

### 2.1 Atomic Region Decomposition (`atomic_region.js`)
1. **Grid Partitioning**: Slices the canvas using unique X and Y cut lines from all layer bounding boxes into elementary non-overlapping rectangles.
2. **Layer Intersections**: Evaluates which layers overlap each atomic rectangle.
3. **Region Merging**: Greedily merges adjacent atomic rectangles sharing identical layer stacks to minimize tile counts.
4. **Contone Rasterization**: Regions with live transparency (`hasTransparency = true`) are composited onto paper-white backing and converted to contone CMYK sub-tiles.
5. **Preflight Validator**: `TransparencyFlattener.preflightCheck(pdfBuffer)` verifies 100% compliance with zero live transparency dictionaries.

---

## 3. Font Outline Decompiler (`src/compositor/font/`)

Downstream commercial print RIPs frequently encounter font rasterization discrepancies or missing font license errors. Poltergeist eliminates this failure mode by decompiling glyph outlines directly into native vector paths (`M`, `L`, `C`, `Z`).

### 3.1 TrueType Outline Decompiler (`truetype.js`)
- Parses table directory: `head`, `maxp`, `loca`, `glyf`, `cmap`.
- Resolves character codepoints to glyph IDs using `cmap` (Format 4 segmented mapping).
- Decompiles `glyf` simple contours:
  - Reconstructs on-curve and off-curve points from relative delta flags.
  - Resolves consecutive off-curve points via implicit on-curve midpoints: P_mid = (P0 + P1) / 2.
  - Converts 2nd-order quadratic Bezier arcs to standard 3rd-order cubic Bezier splines:
    ```text
C1 = P0 + (2/3) × (P1 - P0)
C2 = P2 + (2/3) × (P1 - P2)
```

### 3.2 OpenType CFF CharString Decompiler (`cff.js`)
- Decompiles PostScript Type 2 CharStrings (`rmoveto`, `rlineto`, `rrcurveto`, `hlineto`, `vlineto`, `endchar`).
- Emits unified `VectorPath` primitives for SVG and PDF stream generation.
