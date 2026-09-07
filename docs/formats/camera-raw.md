# Camera RAW & Digital Negative Ingestion Specification

## 1. Overview & Prepress Purpose

**Poltergeist** provides pure native, memory-safe, zero-external-dependency ingestion of Camera RAW digital negatives and sensor mosaics. This subsystem eliminates legacy reliance on `dcraw`, `libraw`, or `exiftool`, delivering high-throughput 1:1 demosaicing directly into calibrated pre-press color spaces.

---

## 2. Supported Sensor Raw Formats & Binary Signatures

| Format | File Extension | Container Type | Header Signature / Magic Bytes | Supported Camera Manufacturers |
| :--- | :--- | :--- | :--- | :--- |
| **Adobe Digital Negative** | `.dng` | TIFF-EP | `II*\0` or `MM\0*` with tag `0xC612` (DNGVersion) | Leica, Pentax, Hasselblad, Ricoh, Mobile DNG |
| **Canon RAW 2** | `.cr2` | TIFF / CR2 | `II*\0\x08\x00\x00\x00CR` (`CR` at offset 8) | Canon EOS DSLR / Mirrorless |
| **Nikon Electronic Format**| `.nef` | TIFF-EP | `II*\0` with Nikon Make / CFA tags | Nikon D-series, Z-series |
| **Sony Alpha RAW** | `.arw`, `.sr2`| TIFF-EP | `II*\0` with Sony SubIFDs | Sony Alpha A7/A9/A1 series |
| **Fujifilm RAF** | `.raf` | Proprietary | `FUJIFILMCCD-RAW` (offset 0) | Fujifilm X-Trans & Bayer series |
| **Olympus RAW** | `.orf` | Proprietary TIFF | `IIRO` (`0x49 0x49 0x52 0x4F`) or `MMOR` | Olympus OM-D, PEN series |
| **Pentax Electronic File** | `.pef` | TIFF-EP | `II*\0` with Pentax MakerNotes | Pentax K-series |
| **Hasselblad 3F RAW** | `.3fr` | TIFF-EP | `II*\0` with Hasselblad tags | Hasselblad H & X medium format |
| **Minolta RAW** | `.mrw` | TTW Block | `\x00MRM` (`0x00 0x4D 0x52 0x4D`) | Minolta DiMAGE series |
| **Sigma X3F** | `.x3f` | Foveon Block | `FOVb` (`0x46 0x4F 0x56 0x62`) | Sigma DP & SD Merrill/Quattro |
| **Mamiya / Leaf RAW** | `.mef` | TIFF-EP | `II*\0` with Leaf digital back tags | Mamiya Leaf Credo/Aptus |
| **Epson RAW** | `.erf` | TIFF-EP | `II*\0` with Epson R-D1 tags | Epson digital rangefinders |

---

## 3. Bayer CFA Sensel Geometry

Digital sensors capture single-channel light intensity filtered through a Color Filter Array (CFA). Poltergeist models all four standard $2 \times 2$ Bayer repeating tessellations:

```text
  RGGB:            BGGR:            GRBG:            GBRG:
  [ R  G ]         [ B  G ]         [ G  R ]         [ G  B ]
  [ G  B ]         [ G  R ]         [ B  G ]         [ R  G ]
```

Sensel channel mapping at coordinate $(row, col)$ is computed via bitwise mask:
$$r = row \ \& \ 1, \quad c = col \ \& \ 1$$

---

## 4. Demosaicing Algorithm & Prepress Calibration

### 4.1 Bilinear Interpolation with Boundary Clamping
To convert single-channel sensel mosaic buffers into continuous 24-bit RGB raster frames:
1. **Sensel Value Normalization**:
   $$V_{\text{norm}} = \min\left(1.0, \frac{\max(0, \text{raw} - \text{blackLevel})}{\text{whiteLevel} - \text{blackLevel}} \times \text{wbGain}\right)$$
2. **Missing Channel Reconstruction**:
   - **At Red Sensel**: Green is interpolated from 4 cross neighbors $(r \pm 1, c)$ and $(r, c \pm 1)$. Blue is interpolated from 4 diagonal neighbors $(r \pm 1, c \pm 1)$.
   - **At Blue Sensel**: Green is interpolated from 4 cross neighbors. Red is interpolated from 4 diagonal neighbors.
   - **At Green Sensel**: Red and Blue are interpolated from orthogonal neighbors depending on whether the adjacent horizontal row sensels are Red or Blue.

### 4.2 Linear to sRGB Tone Curve Application
The raw linear radiometric intensity $V \in [0, 1]$ is converted to standardized sRGB ($D_{65}$) transfer function:
$$sRGB = \begin{cases} 12.92 \times V & V \le 0.0031308 \\ 1.055 \times V^{1/2.4} - 0.055 & V > 0.0031308 \end{cases}$$
Output is rounded to 8-bit unsigned integer $[0..255]$ for direct ingestion into the Poltergeist prepress color transformation pipeline.
