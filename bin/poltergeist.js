#!/usr/bin/env node

/**
 * @file poltergeist.js
 * @description Zero-dependency, memory-safe prepress conversion CLI executable.
 * Drop-in modern replacement for Ghostscript.
 */

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from '../src/cli/args.js';
import { getHelpText, VERSION, formatBenchmark, formatJsonReport } from '../src/cli/formatters.js';
import { convert, convertParallel } from '../src/pipeline/convert.js';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function getDefaultExtension(format) {
  switch (format.toLowerCase()) {
    case 'jpeg':
    case 'jpg':
      return 'jpg';
    case 'tiff':
    case 'tiffsep':
      return 'tif';
    case 'pdf/x-4':
    case 'pdf/x-1a':
    default:
      return 'pdf';
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    process.stdout.write(getHelpText() + '\n');
    process.exit(0);
  }

  if (options.version) {
    process.stdout.write(`poltergeist ${VERSION}\n`);
    process.exit(0);
  }

  // Determine input source
  let input = options.input;
  let inputBytes = null;

  if (input === '-') {
    try {
      inputBytes = await readStdin();
      input = inputBytes;
    } catch (err) {
      process.stderr.write(`poltergeist: error reading from stdin: ${err.message}\n`);
      process.exit(1);
    }
  }

  if (!input) {
    process.stderr.write('poltergeist: error: missing input file or stream\n');
    process.stderr.write('Run "poltergeist --help" for available options and usage.\n');
    process.exit(2);
  }

  const startTime = performance.now();
  const memBefore = process.memoryUsage();

  try {
    const conversionOptions = {
      targetFormat: options.format,
      splitPages: options.splitPages,
      renderProofs: options.renderProofs,
      proofDpi: options.proofDpi,
      proofFormat: options.proofFormat,
      proofQuality: options.proofQuality,
      bypassDownsampling: options.bypassDownsampling,
      targetDpi: options.targetDpi,
      tacMax: options.tacMax,
      page: options.page,
      pages: options.pages,
      parallel: options.parallel,
      maxWorkers: options.maxWorkers
    };

    const result = options.parallel
      ? await convertParallel(input, conversionOptions)
      : convert(input, conversionOptions);

    const endTime = performance.now();
    const elapsedMs = endTime - startTime;
    const memAfter = process.memoryUsage();

    const outputFiles = [];
    let totalBytesOut = 0;

    // Output Handling
    if (result instanceof Map) {
      let outDir = '.';
      if (options.output && options.output !== '-') {
        outDir = options.output;
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }
      }

      for (const [filename, buf] of result.entries()) {
        const destPath = (options.output === '-')
          ? null
          : path.join(outDir, filename);

        if (destPath) {
          fs.writeFileSync(destPath, buf);
        } else {
          process.stdout.write(buf);
        }

        outputFiles.push({
          name: filename,
          path: destPath,
          size: buf.length,
          format: path.extname(filename).slice(1)
        });
        totalBytesOut += buf.length;
      }
    } else if (result instanceof Uint8Array || Buffer.isBuffer(result)) {
      totalBytesOut = result.length;
      const ext = getDefaultExtension(options.format);

      if (options.output === '-') {
        process.stdout.write(result);
        outputFiles.push({ name: 'stdout', path: null, size: result.length, format: ext });
      } else {
        let destPath = options.output;
        if (!destPath) {
          if (typeof input === 'string') {
            const parsed = path.parse(input);
            destPath = path.join(parsed.dir, `${parsed.name}_converted.${ext}`);
          } else {
            destPath = `output.${ext}`;
          }
        }

        const parentDir = path.dirname(destPath);
        if (parentDir && parentDir !== '.' && !fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        fs.writeFileSync(destPath, result);
        outputFiles.push({
          name: path.basename(destPath),
          path: destPath,
          size: result.length,
          format: ext
        });
      }
    }

    // Telemetry & Reporting
    const bytesIn = (typeof input === 'string' && fs.existsSync(input))
      ? fs.statSync(input).size
      : (inputBytes?.length || 0);

    const benchmark = {
      elapsedMs,
      bytesIn,
      bytesOut: totalBytesOut,
      pixelCount: 0,
      memoryUsage: {
        heapUsed: Math.max(0, memAfter.heapUsed - memBefore.heapUsed),
        rss: memAfter.rss
      }
    };

    if (options.json) {
      process.stdout.write(formatJsonReport({
        success: true,
        files: outputFiles,
        elapsedMs,
        benchmark: options.benchmark ? benchmark : undefined
      }) + '\n');
    } else {
      if (options.benchmark) {
        process.stderr.write(formatBenchmark(benchmark) + '\n');
      }
      if (!options.quiet && options.output !== '-') {
        for (const file of outputFiles) {
          process.stderr.write(`[poltergeist] Generated: ${file.path || file.name} (${(file.size / 1024).toFixed(1)} KB)\n`);
        }
      }
    }

    process.exit(0);
  } catch (err) {
    if (options.json) {
      process.stdout.write(formatJsonReport({
        success: false,
        error: err
      }) + '\n');
    } else {
      process.stderr.write(`poltergeist: fatal error: ${err.message}\n`);
    }
    process.exit(1);
  }
}

main();
