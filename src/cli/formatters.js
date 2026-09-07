/**
 * @file formatters.js
 * @description Output formatting and telemetry reporting for the Poltergeist CLI.
 * Supports human-readable progress, benchmark throughput, and structured JSON output.
 */

export const VERSION = '1.0.0';

export function getHelpText() {
  return `
Poltergeist CLI - Prepress Ingestion & Ghostscript Replacement Suite
Version ${VERSION}

USAGE:
  poltergeist [OPTIONS] <input-file>
  poltergeist -i <input-file> -o <output-path> [OPTIONS]
  cat document.pdf | poltergeist -o - [OPTIONS]

MODERN ERGONOMIC FLAGS:
  -i, --input <path|url>      Input file path or S3/HTTP URL
  -o, --output <path>         Output file path, directory, pattern (e.g. page_%d.pdf), or '-'
  -f, --format <format>       Export format: pdf/x-1a (default), pdf/x-4, tiff, tiffsep, jpeg
  -s, --split                 Split multi-page documents into individual single-page files
  -p, --proof [dpi]           Render digital proof images alongside main output (e.g. 72, 300, native)
      --proof-format <fmt>    Proof image format: jpeg (default) or tiff (lossless screentones)
      --proof-quality <1-100> JPEG proof compression quality (default: 85)
      --bypass-downsample     Bypass prepress downsampling (preserves 600/1200 DPI manga line art)
      --preserve-resolution   Alias for --bypass-downsample
      --dpi <number>          Target rendering/raster resolution (default: 300)
      --tac <number>          Total Area Coverage ink limit (default: 300)
      --page <number>         Extract single 1-indexed page
      --pages <range>         Extract page range (e.g. '1,3,5-8')
  -j, --parallel [workers]    Parallel multi-core processing using worker threads
      --workers <number>      Maximum concurrent worker threads
      --benchmark             Display throughput (MP/s, MB/s) and memory metrics
      --json                  Emit structured JSON metadata for machine automation
  -q, --quiet                 Suppress informational logs and progress output
  -v, --version               Display version information
  -h, --help                  Display this help message

GHOSTSCRIPT COMPATIBILITY SWITCHES:
  -sDEVICE=<device>           Emulate GS device: pdfwrite, jpeg, jpeggray, tiffsep, tiff24nc
  -sOutputFile=<dest>         Specify output file destination
  -dSimulateOverprint         Enable subtractive overprint simulation
  -dColorConversionStrategy   Set color space conversion (/DeviceCMYK)
  -dDownsampleColorImages=false Bypass image downsampling
  -r<dpi> or -r<x>x<y>        Specify resolution in DPI
  -dBATCH, -dNOPAUSE, -q      Ignored / quiet mode flags
`;
}

export function formatBenchmark({ elapsedMs, bytesIn, bytesOut, pixelCount, memoryUsage }) {
  const elapsedSec = Math.max(0.001, elapsedMs / 1000);
  const throughputMBs = ((bytesIn / (1024 * 1024)) / elapsedSec).toFixed(2);
  const throughputMPs = ((pixelCount / 1_000_000) / elapsedSec).toFixed(2);
  const heapMB = (memoryUsage.heapUsed / (1024 * 1024)).toFixed(1);
  const rssMB = (memoryUsage.rss / (1024 * 1024)).toFixed(1);

  return [
    '------------------ Poltergeist Benchmark ------------------',
    `  Elapsed Time:     ${elapsedMs.toFixed(1)} ms`,
    `  Input Size:       ${(bytesIn / 1024).toFixed(1)} KB`,
    `  Output Size:      ${(bytesOut / 1024).toFixed(1)} KB`,
    `  Total Pixels:     ${(pixelCount / 1_000_000).toFixed(2)} MP`,
    `  Throughput:       ${throughputMBs} MB/s (${throughputMPs} MP/s)`,
    `  Peak Heap:        ${heapMB} MB (RSS: ${rssMB} MB)`,
    '-----------------------------------------------------------'
  ].join('\n');
}

export function formatJsonReport({ success, files, elapsedMs, benchmark, error }) {
  const report = {
    generator: `Poltergeist v${VERSION}`,
    timestamp: new Date().toISOString(),
    success,
    elapsedMs
  };

  if (files) {
    report.files = files.map(f => ({
      name: f.name,
      sizeBytes: f.size,
      format: f.format
    }));
  }

  if (benchmark) {
    report.benchmark = benchmark;
  }

  if (error) {
    report.error = {
      message: error.message,
      stack: error.stack
    };
  }

  return JSON.stringify(report, null, 2);
}
