/**
 * @file font_outliner.js
 * @description Unified font outline decompiler and text-to-vector path converter.
 * Converts TrueType / OpenType font glyphs directly to pure vector path primitives.
 * Zero-dependency, memory-safe.
 */

import { TrueTypeParser } from './truetype.js';
import { VectorPath } from '../../types/vector.js';

export class FontOutliner {
  /**
   * @param {Uint8Array|Buffer} fontBuffer
   */
  constructor(fontBuffer) {
    this.buffer = fontBuffer instanceof Uint8Array ? fontBuffer : new Uint8Array(fontBuffer);
    this.parser = new TrueTypeParser(this.buffer);
  }

  /**
   * Outlines a string of text into a combined VectorPath at the given font size and origin.
   * 
   * @param {string} text
   * @param {object} [options]
   * @param {number} [options.fontSize] Font size in points/pixels (default: 12)
   * @param {number} [options.x] Starting X origin (default: 0)
   * @param {number} [options.y] Starting Y baseline origin (default: 0)
   * @returns {VectorPath} Combined vector path with all glyph outlines
   */
  outlineText(text, options = {}) {
    const fontSize = options.fontSize || 12;
    const startX = options.x || 0;
    const startY = options.y || 0;
    const scale = fontSize / (this.parser.unitsPerEm || 1000);

    const combinedPath = new VectorPath();
    let cursorX = startX;

    for (let i = 0; i < text.length; i++) {
      const codePoint = text.codePointAt(i);
      const glyphId = this.parser.getGlyphIndex(codePoint);
      const glyphPath = this.parser.decompileGlyph(glyphId);

      // Scale and translate glyph commands into combinedPath
      for (const cmd of glyphPath.commands) {
        if (cmd.type === 'M') {
          combinedPath.moveTo(cursorX + cmd.x * scale, startY - cmd.y * scale);
        } else if (cmd.type === 'L') {
          combinedPath.lineTo(cursorX + cmd.x * scale, startY - cmd.y * scale);
        } else if (cmd.type === 'C') {
          combinedPath.cubicTo(
            cursorX + cmd.cp1x * scale, startY - cmd.cp1y * scale,
            cursorX + cmd.cp2x * scale, startY - cmd.cp2y * scale,
            cursorX + cmd.x * scale, startY - cmd.y * scale
          );
        } else if (cmd.type === 'Z') {
          combinedPath.closePath();
        }
      }

      // Advance cursor (if hmtx is present or standard advance)
      // Standard heuristic advance: ~0.6 * fontSize if not in hmtx
      const bounds = glyphPath.bounds;
      const advance = bounds.width > 0 ? (bounds.width * scale + fontSize * 0.1) : (fontSize * 0.3);
      cursorX += advance;

      // Skip surrogate pair if codePoint > 0xffff
      if (codePoint > 0xffff) {
        i++;
      }
    }

    return combinedPath;
  }

  /**
   * Static helper to quickly outline text from a font buffer.
   * @param {Uint8Array|Buffer} fontBuffer
   * @param {string} text
   * @param {object} [options]
   * @returns {VectorPath}
   */
  static outline(fontBuffer, text, options = {}) {
    const outliner = new FontOutliner(fontBuffer);
    return outliner.outlineText(text, options);
  }
}
