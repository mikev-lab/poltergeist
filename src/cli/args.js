/**
 * @file args.js
 * @description Zero-dependency command-line argument parser for Poltergeist.
 * Supports modern ergonomic flags and comprehensive Ghostscript switch emulation.
 */

import os from 'node:os';

/**
 * Parses raw CLI argument strings into a normalized Poltergeist configuration object.
 * @param {string[]} argv Command-line arguments (typically process.argv.slice(2))
 * @returns {object} Normalized options
 */
export function parseArgs(argv = []) {
  const options = {
    input: null,
    output: null,
    format: 'pdf/x-1a',
    splitPages: false,
    renderProofs: false,
    proofDpi: [72],
    proofFormat: 'jpeg',
    proofQuality: 85,
    bypassDownsampling: false,
    targetDpi: 300,
    tacMax: 300,
    page: undefined,
    pages: undefined,
    parallel: false,
    maxWorkers: undefined,
    json: false,
    benchmark: false,
    quiet: false,
    help: false,
    version: false,
    rawGhostscriptFlags: []
  };

  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // 1. Ghostscript Flag Emulation
    if (arg.startsWith('-sDEVICE=')) {
      const dev = arg.slice('-sDEVICE='.length).toLowerCase();
      options.rawGhostscriptFlags.push(arg);
      if (dev === 'pdfwrite') {
        options.format = 'pdf/x-1a';
      } else if (dev === 'jpeg' || dev === 'jpeggray') {
        options.format = 'jpeg';
      } else if (dev === 'tiffsep' || dev === 'tiffsep1') {
        options.format = 'tiffsep';
      } else if (dev.startsWith('tiff')) {
        options.format = 'tiff';
      }
      continue;
    }

    if (arg.startsWith('-sOutputFile=')) {
      options.output = arg.slice('-sOutputFile='.length);
      options.rawGhostscriptFlags.push(arg);
      continue;
    }

    if (arg === '-dSimulateOverprint' || arg === '-dSimulateOverprint=true') {
      options.simulateOverprint = true;
      options.rawGhostscriptFlags.push(arg);
      continue;
    }

    if (arg.startsWith('-dColorConversionStrategy=')) {
      const strat = arg.slice('-dColorConversionStrategy='.length);
      if (strat.toLowerCase().includes('cmyk')) {
        options.format = options.format === 'jpeg' ? 'jpeg' : 'pdf/x-1a';
      }
      options.rawGhostscriptFlags.push(arg);
      continue;
    }

    if (arg === '-dDownsampleColorImages=false' || arg === '-dDownsampleGrayImages=false') {
      options.bypassDownsampling = true;
      options.rawGhostscriptFlags.push(arg);
      continue;
    }

    if (arg.startsWith('-r')) {
      const dpiStr = arg.slice(2);
      const parts = dpiStr.split('x');
      const dpiVal = parseInt(parts[0], 10);
      if (!isNaN(dpiVal) && dpiVal > 0) {
        options.targetDpi = dpiVal;
      }
      options.rawGhostscriptFlags.push(arg);
      continue;
    }

    if (arg === '-q' || arg === '-dQUIET' || arg === '--quiet') {
      options.quiet = true;
      options.rawGhostscriptFlags.push(arg);
      continue;
    }

    if (arg === '-dBATCH' || arg === '-dNOPAUSE' || arg === '-dSAFER' || arg === '-dPDFSTOPONERROR=false') {
      // Standard Ghostscript batch flags - no-op for compatibility
      options.rawGhostscriptFlags.push(arg);
      continue;
    }

    // 2. Modern Ergonomic Flags
    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '-v' || arg === '--version') {
      options.version = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--benchmark') {
      options.benchmark = true;
      continue;
    }

    if (arg === '-i' || arg === '--input') {
      options.input = argv[++i];
      continue;
    }
    if (arg.startsWith('--input=')) {
      options.input = arg.slice('--input='.length);
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      options.output = argv[++i];
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      continue;
    }

    if (arg === '-f' || arg === '--format') {
      options.format = argv[++i];
      continue;
    }
    if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
      continue;
    }

    if (arg === '-s' || arg === '--split') {
      options.splitPages = true;
      continue;
    }

    if (arg === '-p' || arg === '--proof') {
      options.renderProofs = true;
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        i++;
        options.proofDpi = parseDpiList(next);
      }
      continue;
    }
    if (arg.startsWith('--proof=')) {
      options.renderProofs = true;
      options.proofDpi = parseDpiList(arg.slice('--proof='.length));
      continue;
    }

    if (arg === '--proof-format') {
      options.proofFormat = argv[++i];
      continue;
    }
    if (arg.startsWith('--proof-format=')) {
      options.proofFormat = arg.slice('--proof-format='.length);
      continue;
    }

    if (arg === '--proof-quality') {
      options.proofQuality = parseInt(argv[++i], 10);
      continue;
    }
    if (arg.startsWith('--proof-quality=')) {
      options.proofQuality = parseInt(arg.slice('--proof-quality='.length), 10);
      continue;
    }

    if (arg === '--bypass-downsample' || arg === '--preserve-resolution') {
      options.bypassDownsampling = true;
      continue;
    }

    if (arg === '--dpi') {
      options.targetDpi = parseInt(argv[++i], 10);
      continue;
    }
    if (arg.startsWith('--dpi=')) {
      options.targetDpi = parseInt(arg.slice('--dpi='.length), 10);
      continue;
    }

    if (arg === '--tac') {
      options.tacMax = parseInt(argv[++i], 10);
      continue;
    }
    if (arg.startsWith('--tac=')) {
      options.tacMax = parseInt(arg.slice('--tac='.length), 10);
      continue;
    }

    if (arg === '--page') {
      options.page = parseInt(argv[++i], 10);
      continue;
    }
    if (arg.startsWith('--page=')) {
      options.page = parseInt(arg.slice('--page='.length), 10);
      continue;
    }

    if (arg === '--pages') {
      options.pages = parsePageList(argv[++i]);
      continue;
    }
    if (arg.startsWith('--pages=')) {
      options.pages = parsePageList(arg.slice('--pages='.length));
      continue;
    }

    if (arg === '-j' || arg === '--parallel') {
      options.parallel = true;
      const next = argv[i + 1];
      if (next && !next.startsWith('-') && /^\d+$/.test(next)) {
        i++;
        options.maxWorkers = parseInt(next, 10);
      }
      continue;
    }
    if (arg.startsWith('--parallel=')) {
      options.parallel = true;
      const val = parseInt(arg.slice('--parallel='.length), 10);
      if (!isNaN(val) && val > 0) {
        options.maxWorkers = val;
      }
      continue;
    }

    if (arg === '--workers') {
      options.parallel = true;
      options.maxWorkers = parseInt(argv[++i], 10);
      continue;
    }
    if (arg.startsWith('--workers=')) {
      options.parallel = true;
      options.maxWorkers = parseInt(arg.slice('--workers='.length), 10);
      continue;
    }

    // Positional argument
    positional.push(arg);
  }

  // If input not set by flag, infer from first positional argument
  if (!options.input && positional.length > 0) {
    options.input = positional[0];
  }

  // Default maxWorkers if parallel is requested but count not specified
  if (options.parallel && (!options.maxWorkers || options.maxWorkers < 1)) {
    options.maxWorkers = typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : (os.cpus()?.length || 4);
  }

  return options;
}

function parseDpiList(val) {
  if (!val) return [72];
  return val.split(',').map(s => {
    s = s.trim();
    if (s === 'native' || s === 'source' || s === 'original') return 'native';
    const num = parseInt(s, 10);
    return isNaN(num) ? 72 : num;
  });
}

function parsePageList(val) {
  if (!val) return [];
  const result = [];
  const parts = val.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let p = start; p <= end; p++) {
          result.push(p);
        }
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num)) {
        result.push(num);
      }
    }
  }
  return result;
}
