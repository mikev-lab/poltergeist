/**
 * @file truetype.js
 * @description TrueType ('glyf') font table parser and quadratic-to-cubic Bezier outline decompiler.
 * Zero-dependency, memory-safe.
 */

import { VectorPath } from '../../types/vector.js';

export class TrueTypeParser {
  /**
   * @param {Uint8Array|Buffer} fontBuffer
   */
  constructor(fontBuffer) {
    this.buffer = fontBuffer instanceof Uint8Array ? fontBuffer : new Uint8Array(fontBuffer);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    this.tables = new Map();
    this._parseTableDirectory();
    this._readHeadTable();
    this._readMaxpTable();
  }

  _parseTableDirectory() {
    if (this.buffer.length < 12) {
      throw new Error('TrueType font buffer too small for header.');
    }
    const numTables = this.view.getUint16(4, false);
    if (12 + numTables * 16 > this.buffer.length) {
      throw new Error('TrueType table directory exceeds buffer bounds.');
    }

    for (let i = 0; i < numTables; i++) {
      const offset = 12 + i * 16;
      const tag = String.fromCharCode(
        this.buffer[offset],
        this.buffer[offset + 1],
        this.buffer[offset + 2],
        this.buffer[offset + 3]
      );
      const checkSum = this.view.getUint32(offset + 4, false);
      const tableOffset = this.view.getUint32(offset + 8, false);
      const length = this.view.getUint32(offset + 12, false);

      this.tables.set(tag, { tag, checkSum, offset: tableOffset, length });
    }
  }

  _readHeadTable() {
    const head = this.tables.get('head');
    if (!head || head.length < 54) {
      this.unitsPerEm = 1000;
      this.indexToLocFormat = 0;
      return;
    }
    this.unitsPerEm = this.view.getUint16(head.offset + 18, false) || 1000;
    this.indexToLocFormat = this.view.getInt16(head.offset + 50, false);
  }

  _readMaxpTable() {
    const maxp = this.tables.get('maxp');
    if (!maxp || maxp.length < 6) {
      this.numGlyphs = 0;
      return;
    }
    this.numGlyphs = this.view.getUint16(maxp.offset + 4, false);
  }

  /**
   * Resolves a Unicode codepoint to a glyph index via the 'cmap' table.
   * @param {number} codePoint
   * @returns {number} Glyph index (0 = .notdef)
   */
  getGlyphIndex(codePoint) {
    const cmap = this.tables.get('cmap');
    if (!cmap) return 0;

    const version = this.view.getUint16(cmap.offset, false);
    const numSubtables = this.view.getUint16(cmap.offset + 2, false);

    // Search for Unicode subtables: platform 0 (Unicode) or platform 3 (Windows Unicode)
    let selectedSubtableOffset = 0;
    for (let i = 0; i < numSubtables; i++) {
      const subOffset = cmap.offset + 4 + i * 8;
      const platformId = this.view.getUint16(subOffset, false);
      const encodingId = this.view.getUint16(subOffset + 2, false);
      const offset = this.view.getUint32(subOffset + 4, false);

      if ((platformId === 0) || (platformId === 3 && (encodingId === 1 || encodingId === 10))) {
        selectedSubtableOffset = cmap.offset + offset;
        break;
      }
    }

    if (!selectedSubtableOffset) return 0;

    const format = this.view.getUint16(selectedSubtableOffset, false);
    if (format === 4) {
      // Format 4: Segment mapping for BMP
      const segCountX2 = this.view.getUint16(selectedSubtableOffset + 6, false);
      const segCount = segCountX2 / 2;
      const endCodeOffset = selectedSubtableOffset + 14;
      const startCodeOffset = endCodeOffset + segCountX2 + 2;
      const idDeltaOffset = startCodeOffset + segCountX2;
      const idRangeOffsetTableOffset = idDeltaOffset + segCountX2;

      for (let i = 0; i < segCount; i++) {
        const endCode = this.view.getUint16(endCodeOffset + i * 2, false);
        if (codePoint <= endCode) {
          const startCode = this.view.getUint16(startCodeOffset + i * 2, false);
          if (codePoint >= startCode) {
            const idDelta = this.view.getInt16(idDeltaOffset + i * 2, false);
            const idRangeOffset = this.view.getUint16(idRangeOffsetTableOffset + i * 2, false);

            if (idRangeOffset === 0) {
              return (codePoint + idDelta) & 0xffff;
            } else {
              const glyphIndexAddress = (idRangeOffsetTableOffset + i * 2) + idRangeOffset + (codePoint - startCode) * 2;
              const glyphIndex = this.view.getUint16(glyphIndexAddress, false);
              return glyphIndex !== 0 ? (glyphIndex + idDelta) & 0xffff : 0;
            }
          }
          break;
        }
      }
    }

    return 0;
  }

  /**
   * Retrieves the glyph data byte offset and length in the 'glyf' table.
   * @param {number} glyphId
   * @returns {{ offset: number, length: number }}
   */
  getGlyphLocation(glyphId) {
    const loca = this.tables.get('loca');
    const glyf = this.tables.get('glyf');
    if (!loca || !glyf) return { offset: 0, length: 0 };

    let offset = 0;
    let nextOffset = 0;

    if (this.indexToLocFormat === 0) {
      // Short format (uint16 offsets divided by 2)
      offset = this.view.getUint16(loca.offset + glyphId * 2, false) * 2;
      nextOffset = this.view.getUint16(loca.offset + (glyphId + 1) * 2, false) * 2;
    } else {
      // Long format (uint32 offsets)
      offset = this.view.getUint32(loca.offset + glyphId * 4, false);
      nextOffset = this.view.getUint32(loca.offset + (glyphId + 1) * 4, false);
    }

    const length = nextOffset - offset;
    return { offset: glyf.offset + offset, length };
  }

  /**
   * Decompiles a glyph's TrueType outline into a VectorPath.
   * Converts quadratic Bezier curves with implicit/explicit control points to standard cubic Bezier splines.
   * 
   * @param {number} glyphId
   * @returns {VectorPath}
   */
  decompileGlyph(glyphId) {
    const path = new VectorPath();
    const { offset, length } = this.getGlyphLocation(glyphId);
    if (length <= 10) {
      return path; // Empty glyph (e.g. whitespace)
    }

    const numContours = this.view.getInt16(offset, false);
    if (numContours <= 0) {
      // Composite glyph or empty
      return path;
    }

    // Read endPtsOfContours
    const endPtsOfContours = new Int32Array(numContours);
    let curOffset = offset + 10;
    for (let i = 0; i < numContours; i++) {
      endPtsOfContours[i] = this.view.getUint16(curOffset, false);
      curOffset += 2;
    }

    const numPoints = endPtsOfContours[numContours - 1] + 1;
    const instructionLength = this.view.getUint16(curOffset, false);
    curOffset += 2 + instructionLength; // Skip hinting instructions for pure outline math

    // Read flags
    const flags = new Uint8Array(numPoints);
    let p = 0;
    while (p < numPoints && curOffset < offset + length) {
      const flag = this.buffer[curOffset++];
      flags[p++] = flag;
      if (flag & 0x08) {
        // Repeat flag
        const repeatCount = this.buffer[curOffset++];
        for (let r = 0; r < repeatCount && p < numPoints; r++) {
          flags[p++] = flag;
        }
      }
    }

    // Read X coordinates
    const xCoords = new Int32Array(numPoints);
    let curX = 0;
    for (let i = 0; i < numPoints; i++) {
      const flag = flags[i];
      if (flag & 0x02) {
        // Short vector (1 byte)
        const dx = this.buffer[curOffset++];
        curX += (flag & 0x10) ? dx : -dx;
      } else {
        if (!(flag & 0x10)) {
          // Long vector (2 bytes signed)
          const dx = this.view.getInt16(curOffset, false);
          curOffset += 2;
          curX += dx;
        }
      }
      xCoords[i] = curX;
    }

    // Read Y coordinates
    const yCoords = new Int32Array(numPoints);
    let curY = 0;
    for (let i = 0; i < numPoints; i++) {
      const flag = flags[i];
      if (flag & 0x04) {
        // Short vector (1 byte)
        const dy = this.buffer[curOffset++];
        curY += (flag & 0x20) ? dy : -dy;
      } else {
        if (!(flag & 0x20)) {
          // Long vector (2 bytes signed)
          const dy = this.view.getInt16(curOffset, false);
          curOffset += 2;
          curY += dy;
        }
      }
      yCoords[i] = curY;
    }

    // Decompile each contour into VectorPath commands
    let startIndex = 0;
    for (let c = 0; c < numContours; c++) {
      const endIndex = endPtsOfContours[c];
      const count = endIndex - startIndex + 1;
      if (count <= 0) continue;

      // Extract contour points
      const points = [];
      for (let i = startIndex; i <= endIndex; i++) {
        points.push({
          x: xCoords[i],
          y: yCoords[i],
          onCurve: (flags[i] & 0x01) !== 0
        });
      }

      this._decompileContour(path, points);
      startIndex = endIndex + 1;
    }

    return path;
  }

  /**
   * Decompiles a single contour's points, resolving quadratic Bezier arcs to cubic Beziers.
   * @param {VectorPath} path
   * @param {Array<{ x: number, y: number, onCurve: boolean }>} points
   */
  _decompileContour(path, points) {
    const len = points.length;
    if (len === 0) return;

    // TrueType contour can start with off-curve point!
    let startPoint = points[0];
    let startIdx = 0;

    if (!startPoint.onCurve) {
      if (points[len - 1].onCurve) {
        // Use last point as start
        startPoint = points[len - 1];
        startIdx = 0;
      } else {
        // Both first and last are off-curve: implicit on-curve midpoint is starting point
        startPoint = {
          x: (points[0].x + points[len - 1].x) / 2,
          y: (points[0].y + points[len - 1].y) / 2,
          onCurve: true
        };
      }
    }

    path.moveTo(startPoint.x, startPoint.y);

    let i = startIdx;
    while (i < len) {
      const pt = points[i];
      if (pt.onCurve) {
        if (i !== 0 || !startPoint.onCurve) {
          path.lineTo(pt.x, pt.y);
        }
        i++;
      } else {
        // Quadratic control point!
        const cPoint = pt;
        let nextPoint = points[(i + 1) % len];

        if (!nextPoint.onCurve) {
          // Next is also off-curve: implicit on-curve midpoint!
          nextPoint = {
            x: (cPoint.x + nextPoint.x) / 2,
            y: (cPoint.y + nextPoint.y) / 2,
            onCurve: true
          };
          // Don't advance i past nextPoint, just consume cPoint
          i++;
        } else {
          i += 2;
        }

        // Convert quadratic bezier (current -> cPoint -> nextPoint) to cubic
        // Current point is path's last position
        const currentCmd = path.commands[path.commands.length - 1];
        const p0x = currentCmd.type === 'C' ? currentCmd.x : currentCmd.x;
        const p0y = currentCmd.type === 'C' ? currentCmd.y : currentCmd.y;

        path.quadTo(cPoint.x, cPoint.y, nextPoint.x, nextPoint.y);
      }
    }

    path.closePath();
  }
}
