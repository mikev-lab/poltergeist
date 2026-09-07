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
| **Prepress Resampling** (Bicubic Downsampling) | 800 × 800 → 400 × 400 | **15.60 MP/s** | **44.62 MB/s** | 41.0 ms / 41.3 ms | +0.00 MB |
| **Color Management** (sRGB → CMYK 3D LUT + TAC 300%) | 400 × 400 RGBA8888 | **2.91 MP/s** | **8.33 MB/s** | 55.0 ms / 55.2 ms | +10.18 MB |
| **Layer Compositing & Flattening** (5 layers) | 500 × 500 RGBA8888 | **740.66 MP/s** | **2825.41 MB/s** | 1.69 ms / 1.81 ms | +0.00 MB |
| **Camera RAW Demosaicing** (Bayer RGGB) | 1000 × 1000 sensels (1 MP) | **5.92 MP/s** | **11.29 MB/s** | 168.9 ms / 173.4 ms | +0.00 MB |
| **Plate Separation** (`tiffsep` CMYK Plates) | 600 × 600 CMYK8888 | **63.12 MP/s** | **240.80 MB/s** | 5.70 ms / 5.83 ms | +0.17 MB |

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
