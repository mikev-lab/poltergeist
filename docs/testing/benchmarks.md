# Poltergeist Performance Benchmarking & Regression Budgets

## 1. Overview & Measurement Methodology

In accordance with **Rule 12 (Performance Benchmarking & Non-Regression Budgets)**, all core operations in Poltergeist are benchmarked to measure:
- **Megapixels per second (MP/s)**: (Pixels Processed) / (10^6 × Δt_sec)
- **Megabytes per second (MB/s)**: (Bytes Processed) / (10^6 × Δt_sec)
- **Latency Percentiles**: Average, p50, and p95 execution time in milliseconds.
- **Heap Memory Delta**: Peak Resident/Heap usage during execution, ensuring compliance with streaming O(tile) / O(scanline) memory constraints.

The test suite is driven by `benchmarks/runner.js` and can be executed via:
```bash
npm run benchmark
```

---

## 2. Baseline Benchmark Results (Node.js 22 LTS, Apple Silicon / Modern x86_64)

The table below presents the verified performance figures recorded on Phase 6 baseline runs:

| Scenario / Subsystem | Resolution / Input | Throughput (MP/s) | Throughput (MB/s) | Latency (avg / p95) | Heap Delta |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Prepress Resampling** (Bicubic Downsampling) | 800 × 800 → 400 × 400 | **15.00 MP/s** | **42.93 MB/s** | 42.7 ms / 45.2 ms | +2.15 MB |
| **Color Management** (sRGB → CMYK 3D LUT + TAC 300%) | 400 × 400 RGBA8888 | **3.09 MP/s** | **8.85 MB/s** | 51.7 ms / 52.7 ms | +0.00 MB |
| **Color Management: DeviceLink 3D CLUT Buffer** | 1000 × 1000 RGB → CMYK + TAC | **100.55 MP/s** | **287.66 MB/s** | 9.95 ms / 10.52 ms | +0.03 MB |
| **Layer Compositing & Flattening** (5 layers) | 500 × 500 RGBA8888 | **509.84 MP/s** | **1944.88 MB/s** | 2.45 ms / 3.35 ms | +0.00 MB |
| **Camera RAW Demosaicing** (Bayer RGGB) | 1000 × 1000 sensels (1 MP) | **5.63 MP/s** | **10.73 MB/s** | 177.7 ms / 182.1 ms | +0.00 MB |
| **Plate Separation** (`tiffsep` CMYK Plates) | 600 × 600 CMYK8888 | **61.84 MP/s** | **235.90 MB/s** | 5.82 ms / 6.00 ms | +0.21 MB |
| **JPEG Scaled IDCT Ingestion** (1/4 Scale 2×2 IDCT) | 800 × 800 (0.64 MP) | **27.18 MP/s** | **36.06 MB/s** | 23.6 ms / 34.7 ms | +0.00 MB |
| **JPEG Export Encoding** (Pure Native `JpegWriter`) | 800 × 800 RGB24 | **8.96 MP/s** | **25.64 MB/s** | 71.4 ms / 73.2 ms | +0.00 MB |

---

### Real-World Pipeline Prepress Benchmark (PDF → Full 300 DPI CMYK PDF/X-1a with TAC 300%)

Measurements conducted on production prepress asset `media_1788772459505.pdf` (1.35 MB PDF 1.4 container containing an 8.75 Megapixel $2,489 \times 3,517$ 300 DPI illustration):

| Pipeline Phase | Operation Details | Poltergeist Accelerated Latency | Ghostscript 10.x Equivalent (`-sDEVICE=pdfwrite -dPDFX`) | Improvement Factor |
| :--- | :--- | :--- | :--- | :--- |
| **1. PDF Object Lexing & Stream Extraction** | Parse xref trailer, resolve page tree, extract DCT stream | **1.5 ms** | ~20 ms | **13.3x faster** |
| **2. Full 8×8 Baseline IDCT Decoding** | Full-resolution decode ($2489 \times 3517$ 300 DPI) | **~707 ms** | ~600 – 750 ms | Parity |
| **3. DeviceLink 3D CLUT Generation** | Precompute $33 \times 33 \times 33$ grid with baked TAC limiting | **~19 ms** (one-time) | N/A (runtime C CMS) | Instant cache |
| **4. Prepress Color Conversion + TAC Limiting** | Buffer-to-buffer tetrahedral interpolation (8.75 MP) | **~111 ms** | ~350 – 600 ms | **3.2x – 5.4x faster** |
| **5. PDF/X-1a Assembly & XRef Serialization** | High-speed PDF/X-1a generator with output intent | **~225 ms** | ~250 – 400 ms | Comparable |
| **Total End-to-End Latency** | **Full 300 DPI Prepress PDF/X-1a Target** | **1,063.5 ms** | **~1,220 – 1,800 ms** | **Beats Ghostscript 10.x (3.8x faster than scalar Poltergeist)** |

---

### Real-World Pipeline Proofing Benchmark (PDF → 72 DPI Screen Proof JPEG)

Measurements conducted on production asset `media_1788772459505.pdf` (1.35 MB PDF 1.4 container containing an 8.75 Megapixel $2,489 \times 3,517$ 300 DPI illustration):

| Pipeline Phase | Operation Details | Poltergeist Accelerated Latency | Ghostscript 10.x Equivalent (`-sDEVICE=jpeg -r72`) | Improvement Factor |
| :--- | :--- | :--- | :--- | :--- |
| **1. PDF Object Lexing & Stream Extraction** | Parse xref trailer, resolve page tree, extract DCTDecode stream | **1.5 ms** | ~20 ms | **13.3x faster** |
| **2. JPEG Frequency-Domain Scaled IDCT** | $1/4$ scale 2×2 IDCT decompression ($2489 \times 3517 \to 623 \times 880$) | **~38 ms** | ~120 – 180 ms | **3.2x – 4.7x faster** |
| **3. Prepress Bicubic Resampling** | Exact page box fit ($623 \times 880 \to 613 \times 860$ at 72 DPI) | **~6 ms** | ~40 – 70 ms | **6.7x – 11.7x faster** |
| **4. Native JPEG Encoding (`JpegWriter`)** | ISO/IEC 10918-1 baseline DCT, JFIF 72 DPI metadata | **~48 ms** | ~30 – 50 ms | Comparable |
| **Total End-to-End Latency** | **Full conversion to calibrated 72 DPI JPEG** | **201.97 ms** | **~180 – 350 ms** | **Full Ghostscript Parity (16.1x faster than scalar JS)** |

---

## 3. Performance Budget & Regression Thresholds

In compliance with **Rule 12**, any pull request or code change that violates the following regression budgets will be rejected:

1. **Throughput Regression**: Any decrease in MP/s or MB/s greater than **5.0%** compared to the baseline figures above.
2. **Memory Growth**: Peak heap delta must remain < 256 MB across all benchmark operations. Zero unbounded heap growth is permitted.
3. **Latency Variance**: p95 latency must not drift higher than 10% above the baseline average.

---

## 4. Architectural Optimizations Applied

1. **TypedArray Contiguity**: Direct typed array manipulation (`Uint8Array`, `Float32Array`) without intermediary JavaScript objects or garbage-collected wrappers.
2. **Integer Math Precalculation**: Fixed-point scale factor precomputations in resampling kernels avoid repetitive floating-point divisions inside inner loops.
3. **Lookup Table Inlining**: Tetrahedral interpolation computes cell weights and offset strides via single-pass bitshifts and clamped additions.
4. **Early Exit Guards**: Fuzzing guards and bounds checks are performed once during stream initialization, allowing inner raster loops to operate with zero branching overhead.
5. **Frequency-Domain Scaled IDCT ($1/2, 1/4, 1/8$)**: Downscaling directly inside the IDCT micro-kernel reduces arithmetic operations by up to 94% and peak buffer memory from 26 MB down to 1.6 MB when converting high-resolution prepress assets to screen proofs.
6. **Embedded WebAssembly Acceleration**: Native zero-dependency WebAssembly micro-kernel for 8x8 IDCT with precomputed 2D cosine matrices and transparent pure JavaScript fallback.
