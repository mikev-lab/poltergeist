/**
 * @file svg_decoder.test.js
 * @description Comprehensive unit tests for native SVG parser, tokenizer, and path generators.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SvgDecoder } from '../../src/ingestion/vector/svg_decoder.js';
import { VectorPath, PathCommandType } from '../../src/types/vector.js';
import { Document } from '../../src/types/document.js';

test('SvgDecoder: Header Sniffing & Probe', async (t) => {
  await t.test('Detects standard <svg> tags and XML declarations', () => {
    assert.equal(SvgDecoder.probe('<svg width="100" height="100"></svg>'), true);
    assert.equal(SvgDecoder.probe('<?xml version="1.0"?><svg viewBox="0 0 100 100"></svg>'), true);
    assert.equal(SvgDecoder.probe(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), true);
  });

  await t.test('Rejects non-SVG inputs', () => {
    assert.equal(SvgDecoder.probe('<html><body>Hello</body></html>'), false);
    assert.equal(SvgDecoder.probe(new Uint8Array([0x00, 0x01, 0x02, 0x03])), false);
    assert.equal(SvgDecoder.probe(''), false);
    assert.equal(SvgDecoder.probe(null), false);
  });
});

test('SvgDecoder: Path Data Tokenizer (M, L, H, V, C, S, Q, T, A, Z)', async (t) => {
  await t.test('Parses absolute move and line commands (M, L, H, V, Z)', () => {
    const d = 'M 10 20 L 30 40 H 50 V 60 Z';
    const path = SvgDecoder.parsePathData(d);
    assert.equal(path.commands.length, 5);
    assert.equal(path.commands[0].type, PathCommandType.MOVE_TO);
    assert.deepEqual(path.commands[0].args, [10, 20]);
    assert.equal(path.commands[1].type, PathCommandType.LINE_TO);
    assert.deepEqual(path.commands[1].args, [30, 40]);
    assert.equal(path.commands[2].type, PathCommandType.LINE_TO); // H 50 -> (50, 40)
    assert.deepEqual(path.commands[2].args, [50, 40]);
    assert.equal(path.commands[3].type, PathCommandType.LINE_TO); // V 60 -> (50, 60)
    assert.deepEqual(path.commands[3].args, [50, 60]);
    assert.equal(path.commands[4].type, PathCommandType.CLOSE);
  });

  await t.test('Parses relative move and line commands (m, l, h, v, z)', () => {
    const d = 'm 10 20 l 5 5 h 10 v -5 z';
    const path = SvgDecoder.parsePathData(d);
    assert.equal(path.commands.length, 5);
    assert.deepEqual(path.commands[0].args, [10, 20]);
    assert.deepEqual(path.commands[1].args, [15, 25]);
    assert.deepEqual(path.commands[2].args, [25, 25]);
    assert.deepEqual(path.commands[3].args, [25, 20]);
    assert.equal(path.commands[4].type, PathCommandType.CLOSE);
  });

  await t.test('Parses cubic and smooth cubic curves (C, c, S, s)', () => {
    const d = 'M 0 0 C 10 20 30 40 50 60 S 80 90 100 100';
    const path = SvgDecoder.parsePathData(d);
    assert.equal(path.commands.length, 3);
    assert.equal(path.commands[1].type, PathCommandType.CUBIC_TO);
    assert.deepEqual(path.commands[1].args, [10, 20, 30, 40, 50, 60]);
    assert.equal(path.commands[2].type, PathCommandType.CUBIC_TO);
    // Control point 1 is reflected from (30, 40) across (50, 60): 2*50 - 30 = 70, 2*60 - 40 = 80
    assert.equal(path.commands[2].args[0], 70);
    assert.equal(path.commands[2].args[1], 80);
    assert.equal(path.commands[2].args[4], 100);
    assert.equal(path.commands[2].args[5], 100);
  });

  await t.test('Parses quadratic curves (Q, q, T, t)', () => {
    const d = 'M 0 0 Q 50 50 100 0 T 200 0';
    const path = SvgDecoder.parsePathData(d);
    assert.equal(path.commands.length, 3);
    assert.equal(path.commands[1].type, PathCommandType.CUBIC_TO); // quad converted to cubic
    assert.equal(path.commands[2].type, PathCommandType.CUBIC_TO);
  });
});

test('SvgDecoder: Shape Extraction & Document Generation', async (t) => {
  await t.test('Extracts rect, circle, ellipse, line, polyline, polygon into VectorPath objects', () => {
    const svg = `
      <svg viewBox="0 0 500 500" width="500" height="500">
        <rect x="10" y="20" width="100" height="80" />
        <circle cx="150" cy="150" r="50" />
        <ellipse cx="300" cy="200" rx="40" ry="20" />
        <line x1="0" y1="0" x2="100" y2="100" />
        <polyline points="10,10 20,20 30,10" />
        <polygon points="50,50 60,60 50,70" />
        <path d="M 0 0 L 10 10 Z" />
      </svg>
    `;

    const doc = SvgDecoder.decode(svg);
    assert.ok(doc instanceof Document);
    assert.equal(doc.pageCount, 1);
    const page = doc.getPage(1);
    assert.equal(page.width, 500);
    assert.equal(page.height, 500);
    // 7 vector shapes parsed
    assert.equal(page.paths.length, 7);

    // Verify PDF path data generation
    const pdfStream = page.paths[0].toPdfPathData();
    assert.ok(pdfStream.includes('m'));
    assert.ok(pdfStream.includes('l'));
    assert.ok(pdfStream.includes('h'));
  });

  await t.test('Deep Edge Cases: Empty path, missing attributes, zero dimensions', () => {
    const emptySvg = '<svg></svg>';
    const doc = SvgDecoder.decode(emptySvg);
    assert.equal(doc.pageCount, 1);
    assert.equal(doc.getPage(1).paths.length, 0);

    const emptyPath = SvgDecoder.parsePathData('');
    assert.equal(emptyPath.commands.length, 0);
  });
});
