# Poltergeist CLI Specification & Ghostscript Emulation Manual

## Overview

The `poltergeist` command-line interface provides a zero-dependency, memory-safe, ultra-high-throughput alternative to Ghostscript. It natively ingests raster formats, layered assets (PSD, PSB, CLIP, XCF), Camera RAW negatives, CAD drawings (DXF, DWG), vector graphics (SVG, AI, CDR, WMF), and multi-page documents (PDF, IDML, OpenXML, ODF, iWork, XPS), transforming them into calibrated prepress targets (PDF/X-1a, PDF/X-4, TIFF, discrete plate separations, and JPEG/TIFF digital proofs).

---

## Installation & Invocation

Poltergeist runs on modern Node.js runtimes (Node 22+) without external runtime binaries:

```bash
# Global execution via npm link or global install
npm link
poltergeist --help

# Direct invocation
./bin/poltergeist.js -i input.pdf -o output.pdf -f pdf/x-1a

# Unix Stdin/Stdout Pipeline
cat document.pdf | poltergeist -i - -o - -f jpeg > proof.jpg
```

---

## Modern Ergonomic Flags

| Flag | Type | Description | Default |
| :--- | :--- | :--- | :--- |
| `-i, --input <path\|url>` | String | Source file path, HTTP/S3 URL, or `-` for stdin | Required |
| `-o, --output <path>` | String | Output file, destination directory, or `-` for stdout | Auto-derived |
| `-f, --format <fmt>` | String | `pdf/x-1a`, `pdf/x-4`, `tiff`, `tiffsep`, `jpeg` | `pdf/x-1a` |
| `-s, --split` | Boolean | Split multi-page publications into individual single-page files | `false` |
| `-p, --proof [dpis]` | String/Flag | Generate simultaneous proofs (`72`, `300`, `native` or `72,300`) | `[72]` |
| `--proof-format <fmt>` | String | Proof format: `jpeg` (default) or `tiff` (lossless screentones) | `jpeg` |
| `--proof-quality <1-100>`| Number | JPEG compression quality | `85` |
| `--bypass-downsample` | Boolean | Bypass prepress downsampling (preserves 600/1200 DPI manga line art) | `false` |
| `--preserve-resolution`| Boolean | Alias for `--bypass-downsample` | `false` |
| `--dpi <num>` | Number | Target rendering / downsampling threshold DPI | `300` |
| `--tac <num>` | Number | Prepress Total Area Coverage ink limit (SWOP 300, GRACoL 320) | `300` |
| `--page <num>` | Number | Extract single 1-indexed page | None |
| `--pages <range>` | String | Comma-separated page range (e.g. `1,3,5-8`) | None |
| `-j, --parallel [workers]`| Number/Flag | Parallel multi-core execution using worker threads | Auto (`os.cpus()`) |
| `--workers <num>` | Number | Exact worker thread count | `os.availableParallelism()` |
| `--json` | Boolean | Output structured JSON metadata report | `false` |
| `--benchmark` | Boolean | Output throughput (MP/s, MB/s) and memory metrics | `false` |
| `-q, --quiet` | Boolean | Suppress informational console logs | `false` |
| `-v, --version` | Boolean | Display version information | |
| `-h, --help` | Boolean | Display help manual | |

---

## Ghostscript Command Compatibility Matrix

Poltergeist natively intercepts Ghostscript switches, enabling drop-in replacement in legacy print pipelines without rewriting bash scripts or cron tasks:

```bash
# Drop-in Ghostscript alias in shell profiles:
alias gs="poltergeist"
```

| Ghostscript Switch | Poltergeist Mapping | Action |
| :--- | :--- | :--- |
| `-sDEVICE=pdfwrite` | `-f pdf/x-1a` | High-speed PDF/X-1a prepress generation |
| `-sDEVICE=jpeg` / `jpeggray` | `-f jpeg` | Multi-page / single-page JPEG proofing |
| `-sDEVICE=tiffsep` / `tiffsep1` | `-f tiffsep` | CMYK process + spot color discrete plate separation |
| `-sDEVICE=tiff24nc` / `tiff32nc`| `-f tiff` | Calibrated CMYK TIFF generation |
| `-sOutputFile=<path>` | `-o <path>` | File destination or pattern (e.g. `page_%03d.jpg`) |
| `-dSimulateOverprint` | Internal simulation | Subtractive CMYK overprint simulation |
| `-dColorConversionStrategy=/DeviceCMYK` | Internal color transform | Adobe CMYK conversion with TAC limiting |
| `-dDownsampleColorImages=false` | `--bypass-downsample` | Screentone and true-resolution preservation |
| `-dPDFSTOPONERROR=false` | Native xref self-healing | Tolerates corrupted headers and offsets |
| `-r<dpi>` or `-r<x>x<y>` | `--dpi <dpi>` | Target print resolution |
| `-dBATCH`, `-dNOPAUSE`, `-dSAFER` | Ignored | Accepted as non-op for 100% script parity |
| `-q`, `-dQUIET` | `--quiet` | Suppresses progress logs |

---

## Production Workflows & Examples

### 1. High-Speed PDF to 72 DPI Web Proofs
```bash
poltergeist -i input.pdf -o ./proofs/ -f jpeg --proof 72 -s
```

### 2. Manga Screentone Proofing (Bypass Downsample)
```bash
poltergeist -i chapter_01.clip -o manga_proof.tif --proof-format tiff --bypass-downsample
```

### 3. Multi-Core Commercial Prepress PDF/X-1a Compilation
```bash
poltergeist -i magazine.pdf -o print_ready.pdf -f pdf/x-1a --tac 300 -j 8 --benchmark
```

### 4. Zero-Download Cloud S3 Ingestion
```bash
poltergeist -i https://s3.amazonaws.com/my-bucket/catalog_5gb.pdf -o page_%d.jpg -s --page 1
```

### 5. Automated CI/CD JSON Telemetry
```bash
poltergeist -i brochure.idml -f pdf/x-4 --json > output.json
```
Output:
```json
{
  "generator": "Poltergeist v1.0.0",
  "timestamp": "2026-09-07T20:45:00.000Z",
  "success": true,
  "elapsedMs": 42.8,
  "files": [
    {
      "name": "brochure_converted.pdf",
      "sizeBytes": 142058,
      "format": "pdf"
    }
  ]
}
```
