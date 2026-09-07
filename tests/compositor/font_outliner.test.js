/**
 * @file font_outliner.test.js
 * @description Unit tests for VectorPath primitives, CFF decompiler, and TrueType font outline parser.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VectorPath, PathCommandType } from '../../src/types/vector.js';
import { CffCharStringDecompiler } from '../../src/compositor/font/cff.js';
import { TrueTypeParser } from '../../src/compositor/font/truetype.js';
import { FontOutliner } from '../../src/compositor/font/font_outliner.js';

describe('VectorPath Primitives & Quadratic-to-Cubic Conversion', () => {
  it('Constructs path commands and computes exact bounding box', () => {
    const path = new VectorPath();
    path.moveTo(10, 20);
    path.lineTo(50, 20);
    path.lineTo(50, 80);
    path.lineTo(10, 80);
    path.closePath();

    assert.strictEqual(path.commands.length, 5);
    const bounds = path.bounds;
    assert.strictEqual(bounds.xMin, 10);
    assert.strictEqual(bounds.yMin, 20);
    assert.strictEqual(bounds.xMax, 50);
    assert.strictEqual(bounds.yMax, 80);
    assert.strictEqual(bounds.width, 40);
    assert.strictEqual(bounds.height, 60);
  });

  it('quadTo: Converts quadratic Bezier curve into exact cubic Bezier', () => {
    const path = new VectorPath();
    path.moveTo(0, 0);
    // Quadratic Bezier from (0, 0) with control point (30, 60) to end point (60, 0)
    path.quadTo(30, 60, 60, 0);

    assert.strictEqual(path.commands.length, 2);
    const cubic = path.commands[1];
    assert.strictEqual(cubic.type, PathCommandType.CUBIC_TO);

    // C1 = P0 + 2/3 * (P1 - P0) = 0 + 2/3 * 30 = 20
    // C1y = 0 + 2/3 * 60 = 40
    assert.ok(Math.abs(cubic.cp1x - 20) < 1e-4);
    assert.ok(Math.abs(cubic.cp1y - 40) < 1e-4);

    // C2 = P2 + 2/3 * (P1 - P2) = 60 + 2/3 * (30 - 60) = 60 - 20 = 40
    // C2y = 0 + 2/3 * (60 - 0) = 40
    assert.ok(Math.abs(cubic.cp2x - 40) < 1e-4);
    assert.ok(Math.abs(cubic.cp2y - 40) < 1e-4);

    assert.strictEqual(cubic.x, 60);
    assert.strictEqual(cubic.y, 0);
  });

  it('Emits valid SVG path string and PDF content stream operators', () => {
    const path = new VectorPath();
    path.moveTo(0, 0);
    path.lineTo(100, 100);
    path.closePath();

    const svg = path.toSvgPath();
    assert.strictEqual(svg, 'M 0 0 L 100 100 Z');

    const pdf = path.toPdfStream();
    assert.strictEqual(pdf, '0 0 m 100 100 l h');
  });
});

describe('CFF CharString Decompiler', () => {
  it('Decompiles Type 2 CharString bytecode (rmoveto, rlineto, endchar)', () => {
    // Type 2 bytecode:
    // 50 (val = 50 - 139 + 139? wait: 50 + 139 = 189 byte)
    // 10 20 rmoveto: 10 = 149, 20 = 159, 21 = rmoveto
    // 30 0 rlineto: 30 = 169, 0 = 139, 5 = rlineto
    // 14 = endchar
    const bytecode = new Uint8Array([
      149, 159, 21,  // rmoveto (dx=10, dy=20) -> (10, 20)
      169, 139, 5,   // rlineto (dx=30, dy=0) -> (40, 20)
      14             // endchar
    ]);

    const path = CffCharStringDecompiler.decompile(bytecode);
    assert.ok(path.commands.length >= 3);
    assert.strictEqual(path.commands[0].type, PathCommandType.MOVE_TO);
    assert.strictEqual(path.commands[0].x, 10);
    assert.strictEqual(path.commands[0].y, 20);

    assert.strictEqual(path.commands[1].type, PathCommandType.LINE_TO);
    assert.strictEqual(path.commands[1].x, 40);
    assert.strictEqual(path.commands[1].y, 20);

    assert.strictEqual(path.commands[2].type, PathCommandType.CLOSE_PATH);
  });
});

describe('TrueType Font Outline Parser & FontOutliner', () => {
  it('TrueTypeParser: Rejects truncated buffer under 12 bytes', () => {
    assert.throws(() => {
      new TrueTypeParser(new Uint8Array(8));
    }, /too small/);
  });

  it('FontOutliner: Outlines glyphs and calculates text path', () => {
    // Construct a minimal valid TrueType binary font structure
    // 12 bytes offset table + 3 table records (head, maxp, loca, glyf, cmap)
    const buf = new Uint8Array(512);
    const view = new DataView(buf.buffer);

    // sfnt version: 0x00010000 (TrueType)
    view.setUint32(0, 0x00010000, false);
    const numTables = 5;
    view.setUint16(4, numTables, false);

    // Write table records: head, maxp, loca, glyf, cmap
    let tableOffset = 12 + numTables * 16;

    function addTable(tag, size, writeFn) {
      const idx = addTable.count || 0;
      addTable.count = idx + 1;
      const recOffset = 12 + idx * 16;
      for (let c = 0; c < 4; c++) buf[recOffset + c] = tag.charCodeAt(c);
      view.setUint32(recOffset + 4, 0, false); // checksum
      view.setUint32(recOffset + 8, tableOffset, false);
      view.setUint32(recOffset + 12, size, false);
      writeFn(tableOffset);
      tableOffset += size;
    }

    // 1. head (54 bytes)
    addTable('head', 54, (pos) => {
      view.setUint16(pos + 18, 1000, false); // unitsPerEm = 1000
      view.setInt16(pos + 50, 0, false);     // indexToLocFormat = 0 (short)
    });

    // 2. maxp (32 bytes)
    addTable('maxp', 32, (pos) => {
      view.setUint16(pos + 4, 2, false); // numGlyphs = 2
    });

    // 3. loca (6 bytes for 2 glyphs + 1)
    // glyph 0: offset 0 to 0 (empty)
    // glyph 1: offset 0 to 24 (length 24)
    addTable('loca', 6, (pos) => {
      view.setUint16(pos + 0, 0, false);
      view.setUint16(pos + 2, 0, false);
      view.setUint16(pos + 4, 12, false); // offset = 12*2 = 24
    });

    // 4. glyf (24 bytes): simple square contour for glyph 1
    addTable('glyf', 24, (pos) => {
      view.setInt16(pos + 0, 1, false);    // numberOfContours = 1
      view.setInt16(pos + 2, 0, false);    // xMin
      view.setInt16(pos + 4, 0, false);    // yMin
      view.setInt16(pos + 6, 100, false);  // xMax
      view.setInt16(pos + 8, 100, false);  // yMax
      view.setUint16(pos + 10, 3, false);  // endPtsOfContours[0] = 3 (4 points: 0,1,2,3)
      view.setUint16(pos + 12, 0, false);  // instructionLength = 0

      // Flags: 4 points, all on-curve (0x01), short vector x (0x02), short vector y (0x04)
      buf[pos + 14] = 0x13; // point 0: on-curve, x-short positive, y-short positive
      buf[pos + 15] = 0x13; // point 1
      buf[pos + 16] = 0x13; // point 2
      buf[pos + 17] = 0x13; // point 3

      // X coordinates (dx): (0, 100, 0, 100) -> 0, 100, 0, -100
      buf[pos + 18] = 0;
      buf[pos + 19] = 100;
      buf[pos + 20] = 0;
      buf[pos + 21] = 0;

      // Y coordinates (dy)
      buf[pos + 22] = 0;
      buf[pos + 23] = 100;
    });

    // 5. cmap (Format 4, 40 bytes)
    addTable('cmap', 40, (pos) => {
      view.setUint16(pos + 0, 0, false); // version
      view.setUint16(pos + 2, 1, false); // numSubtables = 1
      view.setUint16(pos + 4, 0, false); // platformId = 0 (Unicode)
      view.setUint16(pos + 6, 3, false); // encodingId = 3
      view.setUint32(pos + 8, 12, false); // offset = 12

      const sub = pos + 12;
      view.setUint16(sub + 0, 4, false);  // format = 4
      view.setUint16(sub + 2, 28, false); // length = 28
      view.setUint16(sub + 6, 2, false);  // segCountX2 = 2
      view.setUint16(sub + 14, 0x0041, false); // endCode[0] = 'A' (65)
      view.setUint16(sub + 16, 0, false);      // reservedPad
      view.setUint16(sub + 18, 0x0041, false); // startCode[0] = 'A'
      view.setInt16(sub + 20, -64, false);     // idDelta = -64 (65 - 64 = 1 -> glyphId 1)
      view.setUint16(sub + 22, 0, false);      // idRangeOffset = 0
    });

    const outliner = new FontOutliner(buf);
    assert.strictEqual(outliner.parser.unitsPerEm, 1000);
    assert.strictEqual(outliner.parser.numGlyphs, 2);

    const glyphId = outliner.parser.getGlyphIndex(0x0041); // 'A'
    assert.strictEqual(glyphId, 1);

    const textPath = outliner.outlineText('A', { fontSize: 24 });
    assert.ok(textPath.commands.length > 0);
  });
});
