# Transparency Flattening & Font Outlining Pipeline (`transparency-and-fonts.md`)

This document details the multi-layer compositing math, separable blend mode equations, PDF/X-1a transparency flattening engine, and font outline decompilation pipeline in **Poltergeist**.

---

## 1. Multi-Layer Compositing & Blend Modes (`src/compositor/blend/`)

### 1.1 Porter-Duff Alpha Math
For arbitrary source ($S$) and backdrop ($B$) samples with respective opacities $\alpha_s$ and $\alpha_b$, the resulting alpha $\alpha_r$ and color $C_r$ under Source Over are:
$$\alpha_r = \alpha_s + \alpha_b(1 - \alpha_s)$$
$$C_r = \frac{C_s \alpha_s + C_b \alpha_b(1 - \alpha_s)}{\alpha_r}$$

### 1.2 Separable Blend Mode Equations (ISO 32000 & Adobe Photoshop)
When a separable blend mode $B(C_b, C_s)$ is active with non-unity alphas:
$$C_r = \frac{(1 - \alpha_b)\alpha_s C_s + (1 - \alpha_s)\alpha_b C_b + \alpha_s \alpha_b B(C_b, C_s)}{\alpha_r}$$

Supported mathematical blend functions:
- **Multiply**: $B(C_b, C_s) = C_b \cdot C_s$
- **Screen**: $B(C_b, C_s) = C_b + C_s - C_b \cdot C_s$
- **Overlay**:
  $$B(C_b, C_s) = \begin{cases} 2 C_b C_s & \text{if } C_b \le 0.5 \\ 1 - 2(1 - C_b)(1 - C_s) & \text{otherwise} \end{cases}$$
- **Hard Light**:
  $$B(C_b, C_s) = \begin{cases} 2 C_b C_s & \text{if } C_s \le 0.5 \\ 1 - 2(1 - C_b)(1 - C_s) & \text{otherwise} \end{cases}$$
- **Darken**: $B(C_b, C_s) = \min(C_b, C_s)$
- **Lighten**: $B(C_b, C_s) = \max(C_b, C_s)$
- **Difference**: $B(C_b, C_s) = |C_b - C_s|$
- **Exclusion**: $B(C_b, C_s) = C_b + C_s - 2 C_b C_s$
- **Color Dodge**: $B(C_b, C_s) = \min(1, C_b / (1 - C_s))$
- **Color Burn**: $B(C_b, C_s) = 1 - \min(1, (1 - C_b) / C_s)$

### 1.3 Clipping Mask Modulations
When a layer has `clipping = true`, its effective alpha at coordinate $(x, y)$ is modulated by the base layer's alpha plane:
$$\alpha_{\text{clipped}}(x, y) = \alpha_{\text{layer}}(x, y) \cdot \alpha_{\text{base}}(x, y)$$
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
  - Resolves consecutive off-curve points via implicit on-curve midpoints: $P_{\text{mid}} = (P_0 + P_1) / 2$.
  - Converts 2nd-order quadratic Bezier arcs to standard 3rd-order cubic Bezier splines:
    $$C_1 = P_0 + \frac{2}{3}(P_1 - P_0)$$
    $$C_2 = P_2 + \frac{2}{3}(P_1 - P_2)$$

### 3.2 OpenType CFF CharString Decompiler (`cff.js`)
- Decompiles PostScript Type 2 CharStrings (`rmoveto`, `rlineto`, `rrcurveto`, `hlineto`, `vlineto`, `endchar`).
- Emits unified `VectorPath` primitives for SVG and PDF stream generation.
