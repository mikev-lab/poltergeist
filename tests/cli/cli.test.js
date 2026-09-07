import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { parseArgs } from '../../src/cli/args.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve('bin/poltergeist.js');

test('CLI Args: Modern ergonomic flags', () => {
  const args = [
    '-i', 'input.pdf',
    '-o', 'output.pdf',
    '-f', 'pdf/x-4',
    '-s',
    '-p', '72,300,native',
    '--proof-format', 'tiff',
    '--proof-quality', '90',
    '--bypass-downsample',
    '--dpi', '600',
    '--tac', '280',
    '--pages', '1,3-5',
    '-j', '4',
    '--benchmark',
    '--json',
    '--quiet'
  ];

  const opts = parseArgs(args);
  assert.equal(opts.input, 'input.pdf');
  assert.equal(opts.output, 'output.pdf');
  assert.equal(opts.format, 'pdf/x-4');
  assert.equal(opts.splitPages, true);
  assert.equal(opts.renderProofs, true);
  assert.deepEqual(opts.proofDpi, [72, 300, 'native']);
  assert.equal(opts.proofFormat, 'tiff');
  assert.equal(opts.proofQuality, 90);
  assert.equal(opts.bypassDownsampling, true);
  assert.equal(opts.targetDpi, 600);
  assert.equal(opts.tacMax, 280);
  assert.deepEqual(opts.pages, [1, 3, 4, 5]);
  assert.equal(opts.parallel, true);
  assert.equal(opts.maxWorkers, 4);
  assert.equal(opts.benchmark, true);
  assert.equal(opts.json, true);
  assert.equal(opts.quiet, true);
});

test('CLI Args: Ghostscript switch emulation', () => {
  const args = [
    '-sDEVICE=jpeg',
    '-sOutputFile=out_%03d.jpg',
    '-dSimulateOverprint',
    '-dColorConversionStrategy=/DeviceCMYK',
    '-dDownsampleColorImages=false',
    '-r300',
    '-q',
    '-dBATCH',
    '-dNOPAUSE',
    'sample.pdf'
  ];

  const opts = parseArgs(args);
  assert.equal(opts.format, 'jpeg');
  assert.equal(opts.output, 'out_%03d.jpg');
  assert.equal(opts.simulateOverprint, true);
  assert.equal(opts.bypassDownsampling, true);
  assert.equal(opts.targetDpi, 300);
  assert.equal(opts.quiet, true);
  assert.equal(opts.input, 'sample.pdf');
});

test('CLI Integration: --help displays usage and exits with 0', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, '--help']);
  assert.ok(stdout.includes('Poltergeist CLI'));
  assert.ok(stdout.includes('GHOSTSCRIPT COMPATIBILITY SWITCHES'));
  assert.equal(stderr, '');
});

test('CLI Integration: --version displays version string and exits with 0', async () => {
  const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, '--version']);
  assert.match(stdout, /^poltergeist \d+\.\d+\.\d+/);
});

test('CLI Integration: Missing input returns exit code 2 with usage hint', async () => {
  try {
    await execFileAsync(process.execPath, [CLI_PATH]);
    assert.fail('Should have failed with exit code 2');
  } catch (err) {
    assert.equal(err.code, 2);
    assert.ok(err.stderr.includes('missing input file or stream'));
  }
});

test('CLI Integration: File conversion to PDF/X-1a and JPEG', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poltergeist-cli-test-'));
  const svgPath = path.join(tmpDir, 'test.svg');
  const pdfOut = path.join(tmpDir, 'test.pdf');
  const jpgOut = path.join(tmpDir, 'test.jpg');

  fs.writeFileSync(svgPath, '<svg width="200" height="200"><rect width="200" height="200" fill="red"/></svg>');

  try {
    // 1. Convert to PDF/X-1a
    await execFileAsync(process.execPath, [CLI_PATH, '-i', svgPath, '-o', pdfOut, '-f', 'pdf/x-1a']);
    assert.ok(fs.existsSync(pdfOut));
    const pdfBuf = fs.readFileSync(pdfOut);
    assert.ok(pdfBuf.length > 100);
    assert.equal(pdfBuf.subarray(0, 4).toString(), '%PDF');

    // 2. Convert to JPEG with GS switch emulation and --json
    const { stdout } = await execFileAsync(process.execPath, [
      CLI_PATH,
      '-sDEVICE=jpeg',
      `-sOutputFile=${jpgOut}`,
      '--json',
      svgPath
    ]);

    assert.ok(fs.existsSync(jpgOut));
    const jpgBuf = fs.readFileSync(jpgOut);
    assert.equal(jpgBuf[0], 0xFF);
    assert.equal(jpgBuf[1], 0xD8);

    const report = JSON.parse(stdout);
    assert.equal(report.success, true);
    assert.ok(report.files.length >= 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI Integration: Stdin streaming to stdout with -o -', async () => {
  const child = spawn(process.execPath, [CLI_PATH, '-i', '-', '-o', '-', '-f', 'jpeg']);

  const svgContent = '<svg width="50" height="50"><rect width="50" height="50" fill="blue"/></svg>';
  child.stdin.write(svgContent);
  child.stdin.end();

  const chunks = [];
  child.stdout.on('data', chunk => chunks.push(chunk));

  const exitCode = await new Promise(resolve => child.on('close', resolve));
  assert.equal(exitCode, 0);

  const outBuf = Buffer.concat(chunks);
  assert.ok(outBuf.length > 50);
  assert.equal(outBuf[0], 0xFF);
  assert.equal(outBuf[1], 0xD8);
});
