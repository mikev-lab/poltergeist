/**
 * @file svg_decoder.js
 * @description Native SVG vector graphic parser and path tokenizer for Poltergeist.
 * Strictly zero-dependency and memory-safe.
 * Parses viewBox, paths (M, L, H, V, C, S, Q, T, A, Z), and basic shapes (rect, circle, ellipse, line, polygon, polyline).
 */

import { VectorPath, PathCommandType } from '../../types/vector.js';
import { Document, PageRecord, PageBox } from '../../types/document.js';
import { ColorSpaceType } from '../../types/image.js';

export class SvgDecoder {
  /**
   * Sniffs whether buffer or text is an SVG document.
   * @param {Uint8Array|string} input
   * @returns {boolean}
   */
  static probe(input) {
    if (!input) return false;
    let text = '';
    if (typeof input === 'string') {
      text = input.slice(0, 1024);
    } else if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
      const len = Math.min(input.length, 1024);
      text = new TextDecoder('utf8', { fatal: false }).decode(input.subarray(0, len));
    } else {
      return false;
    }
    const lower = text.toLowerCase();
    return lower.includes('<svg') || (lower.includes('<?xml') && lower.includes('<svg'));
  }

  /**
   * Decodes SVG content into a Document model with vector paths.
   * @param {Uint8Array|string} input
   * @param {object} [options]
   * @returns {Document}
   */
  static decode(input, options = {}) {
    let svgText = '';
    if (typeof input === 'string') {
      svgText = input;
    } else if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
      svgText = new TextDecoder('utf8').decode(input);
    } else {
      throw new TypeError('Invalid SVG input: expected string or Uint8Array.');
    }

    if (!SvgDecoder.probe(svgText)) {
      throw new Error('Unsupported or invalid SVG file signature.');
    }

    // Extract viewBox or width/height attributes from <svg ...>
    const svgTagMatch = svgText.match(/<svg\b([^>]*)>/i);
    const svgAttrs = svgTagMatch ? svgTagMatch[1] : '';

    let width = 612;
    let height = 792;
    let minX = 0;
    let minY = 0;

    const viewBoxMatch = svgAttrs.match(/viewBox\s*=\s*["']\s*([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)[,\s]+([-\d.]+)\s*["']/i);
    if (viewBoxMatch) {
      minX = parseFloat(viewBoxMatch[1]);
      minY = parseFloat(viewBoxMatch[2]);
      width = parseFloat(viewBoxMatch[3]);
      height = parseFloat(viewBoxMatch[4]);
    } else {
      const widthMatch = svgAttrs.match(/\bwidth\s*=\s*["']\s*([-\d.]+)(?:px|pt)?\s*["']/i);
      const heightMatch = svgAttrs.match(/\bheight\s*=\s*["']\s*([-\d.]+)(?:px|pt)?\s*["']/i);
      if (widthMatch) width = parseFloat(widthMatch[1]);
      if (heightMatch) height = parseFloat(heightMatch[1]);
    }

    if (isNaN(width) || width <= 0) width = 612;
    if (isNaN(height) || height <= 0) height = 792;

    const paths = [];

    // Parse <path d="..." />
    const pathRegex = /<path\b([^>]*)\/?>/gi;
    let match;
    while ((match = pathRegex.exec(svgText)) !== null) {
      const attrs = match[1];
      const dMatch = attrs.match(/\bd\s*=\s*["']([^"']*)["']/i);
      if (dMatch && dMatch[1]) {
        const vPath = SvgDecoder.parsePathData(dMatch[1]);
        if (vPath.commands.length > 0) {
          paths.push(vPath);
        }
      }
    }

    // Parse <rect x="..." y="..." width="..." height="..." />
    const rectRegex = /<rect\b([^>]*)\/?>/gi;
    while ((match = rectRegex.exec(svgText)) !== null) {
      const attrs = match[1];
      const x = parseFloat(SvgDecoder._getAttr(attrs, 'x') || '0');
      const y = parseFloat(SvgDecoder._getAttr(attrs, 'y') || '0');
      const w = parseFloat(SvgDecoder._getAttr(attrs, 'width') || '0');
      const h = parseFloat(SvgDecoder._getAttr(attrs, 'height') || '0');
      if (w > 0 && h > 0) {
        const p = new VectorPath();
        p.moveTo(x, y);
        p.lineTo(x + w, y);
        p.lineTo(x + w, y + h);
        p.lineTo(x, y + h);
        p.closePath();
        paths.push(p);
      }
    }

    // Parse <circle cx="..." cy="..." r="..." />
    const circleRegex = /<circle\b([^>]*)\/?>/gi;
    const K = 0.5522847498; // cubic bezier circular constant
    while ((match = circleRegex.exec(svgText)) !== null) {
      const attrs = match[1];
      const cx = parseFloat(SvgDecoder._getAttr(attrs, 'cx') || '0');
      const cy = parseFloat(SvgDecoder._getAttr(attrs, 'cy') || '0');
      const r = parseFloat(SvgDecoder._getAttr(attrs, 'r') || '0');
      if (r > 0) {
        const p = new VectorPath();
        const ox = r * K;
        const oy = r * K;
        p.moveTo(cx, cy - r);
        p.cubicTo(cx + ox, cy - r, cx + r, cy - oy, cx + r, cy);
        p.cubicTo(cx + r, cy + oy, cx + ox, cy + r, cx, cy + r);
        p.cubicTo(cx - ox, cy + r, cx - r, cy + oy, cx - r, cy);
        p.cubicTo(cx - r, cy - oy, cx - ox, cy - r, cx, cy - r);
        p.closePath();
        paths.push(p);
      }
    }

    // Parse <ellipse cx="..." cy="..." rx="..." ry="..." />
    const ellipseRegex = /<ellipse\b([^>]*)\/?>/gi;
    while ((match = ellipseRegex.exec(svgText)) !== null) {
      const attrs = match[1];
      const cx = parseFloat(SvgDecoder._getAttr(attrs, 'cx') || '0');
      const cy = parseFloat(SvgDecoder._getAttr(attrs, 'cy') || '0');
      const rx = parseFloat(SvgDecoder._getAttr(attrs, 'rx') || '0');
      const ry = parseFloat(SvgDecoder._getAttr(attrs, 'ry') || '0');
      if (rx > 0 && ry > 0) {
        const p = new VectorPath();
        const ox = rx * K;
        const oy = ry * K;
        p.moveTo(cx, cy - ry);
        p.cubicTo(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy);
        p.cubicTo(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry);
        p.cubicTo(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy);
        p.cubicTo(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry);
        p.closePath();
        paths.push(p);
      }
    }

    // Parse <line x1="..." y1="..." x2="..." y2="..." />
    const lineRegex = /<line\b([^>]*)\/?>/gi;
    while ((match = lineRegex.exec(svgText)) !== null) {
      const attrs = match[1];
      const x1 = parseFloat(SvgDecoder._getAttr(attrs, 'x1') || '0');
      const y1 = parseFloat(SvgDecoder._getAttr(attrs, 'y1') || '0');
      const x2 = parseFloat(SvgDecoder._getAttr(attrs, 'x2') || '0');
      const y2 = parseFloat(SvgDecoder._getAttr(attrs, 'y2') || '0');
      const p = new VectorPath();
      p.moveTo(x1, y1);
      p.lineTo(x2, y2);
      paths.push(p);
    }

    // Parse <polyline points="..." /> and <polygon points="..." />
    const polyRegex = /<(polyline|polygon)\b([^>]*)\/?>/gi;
    while ((match = polyRegex.exec(svgText)) !== null) {
      const isPolygon = match[1].toLowerCase() === 'polygon';
      const attrs = match[2];
      const pointsStr = SvgDecoder._getAttr(attrs, 'points');
      if (pointsStr) {
        const nums = pointsStr.trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
        if (nums.length >= 4) {
          const p = new VectorPath();
          p.moveTo(nums[0], nums[1]);
          for (let i = 2; i < nums.length; i += 2) {
            p.lineTo(nums[i], nums[i + 1]);
          }
          if (isPolygon) p.closePath();
          paths.push(p);
        }
      }
    }

    const page = new PageRecord({
      pageNumber: 1,
      width,
      height,
      boxes: new PageBox({ mediaBox: [minX, minY, minX + width, minY + height] }),
      paths
    });

    return new Document({
      title: options.title || 'SVG Document',
      creator: 'Poltergeist Native SVG Ingestion Engine',
      pages: [page],
      colorSpace: ColorSpaceType.RGB
    });
  }

  /**
   * Tokenizes SVG path string (d="...") into PathCommand entries.
   * Handles absolute and relative M, L, H, V, C, S, Q, T, A, Z.
   * @param {string} d
   * @returns {VectorPath}
   */
  static parsePathData(d) {
    const vPath = new VectorPath();
    if (!d || typeof d !== 'string') return vPath;

    // Split into tokens: letters or numbers
    const tokens = d.match(/([a-df-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi);
    if (!tokens) return vPath;

    let curCmd = '';
    let curX = 0;
    let curY = 0;
    let startX = 0;
    let startY = 0;
    let lastCpX = 0;
    let lastCpY = 0;
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];
      if (/^[a-df-z]$/i.test(token)) {
        curCmd = token;
        i++;
      }

      if (!curCmd) break;

      const isRel = curCmd === curCmd.toLowerCase();
      const cmd = curCmd.toUpperCase();

      if (cmd === 'M') {
        if (i + 1 >= tokens.length) break;
        let x = parseFloat(tokens[i++]);
        let y = parseFloat(tokens[i++]);
        if (isRel) {
          x += curX;
          y += curY;
        }
        vPath.moveTo(x, y);
        curX = x;
        curY = y;
        startX = x;
        startY = y;
        lastCpX = curX;
        lastCpY = curY;
        // Subsequent coordinate pairs after M are treated as LineTo (per SVG spec)
        curCmd = isRel ? 'l' : 'L';
      } else if (cmd === 'L') {
        if (i + 1 >= tokens.length) break;
        let x = parseFloat(tokens[i++]);
        let y = parseFloat(tokens[i++]);
        if (isRel) {
          x += curX;
          y += curY;
        }
        vPath.lineTo(x, y);
        curX = x;
        curY = y;
        lastCpX = curX;
        lastCpY = curY;
      } else if (cmd === 'H') {
        if (i >= tokens.length) break;
        let x = parseFloat(tokens[i++]);
        if (isRel) x += curX;
        vPath.lineTo(x, curY);
        curX = x;
        lastCpX = curX;
        lastCpY = curY;
      } else if (cmd === 'V') {
        if (i >= tokens.length) break;
        let y = parseFloat(tokens[i++]);
        if (isRel) y += curY;
        vPath.lineTo(curX, y);
        curY = y;
        lastCpX = curX;
        lastCpY = curY;
      } else if (cmd === 'C') {
        if (i + 5 >= tokens.length) break;
        let cp1x = parseFloat(tokens[i++]);
        let cp1y = parseFloat(tokens[i++]);
        let cp2x = parseFloat(tokens[i++]);
        let cp2y = parseFloat(tokens[i++]);
        let x = parseFloat(tokens[i++]);
        let y = parseFloat(tokens[i++]);
        if (isRel) {
          cp1x += curX;
          cp1y += curY;
          cp2x += curX;
          cp2y += curY;
          x += curX;
          y += curY;
        }
        vPath.cubicTo(cp1x, cp1y, cp2x, cp2y, x, y);
        curX = x;
        curY = y;
        lastCpX = cp2x;
        lastCpY = cp2y;
      } else if (cmd === 'S') {
        if (i + 3 >= tokens.length) break;
        // Reflected first control point: 2 * cur - lastCp
        const cp1x = 2 * curX - lastCpX;
        const cp1y = 2 * curY - lastCpY;
        let cp2x = parseFloat(tokens[i++]);
        let cp2y = parseFloat(tokens[i++]);
        let x = parseFloat(tokens[i++]);
        let y = parseFloat(tokens[i++]);
        if (isRel) {
          cp2x += curX;
          cp2y += curY;
          x += curX;
          y += curY;
        }
        vPath.cubicTo(cp1x, cp1y, cp2x, cp2y, x, y);
        curX = x;
        curY = y;
        lastCpX = cp2x;
        lastCpY = cp2y;
      } else if (cmd === 'Q') {
        if (i + 3 >= tokens.length) break;
        let qx = parseFloat(tokens[i++]);
        let qy = parseFloat(tokens[i++]);
        let x = parseFloat(tokens[i++]);
        let y = parseFloat(tokens[i++]);
        if (isRel) {
          qx += curX;
          qy += curY;
          x += curX;
          y += curY;
        }
        vPath.quadTo(qx, qy, x, y);
        curX = x;
        curY = y;
        lastCpX = qx;
        lastCpY = qy;
      } else if (cmd === 'T') {
        if (i + 1 >= tokens.length) break;
        const qx = 2 * curX - lastCpX;
        const qy = 2 * curY - lastCpY;
        let x = parseFloat(tokens[i++]);
        let y = parseFloat(tokens[i++]);
        if (isRel) {
          x += curX;
          y += curY;
        }
        vPath.quadTo(qx, qy, x, y);
        curX = x;
        curY = y;
        lastCpX = qx;
        lastCpY = qy;
      } else if (cmd === 'A') {
        // Arc command: rx ry x-axis-rotation large-arc-flag sweep-flag x y
        if (i + 6 >= tokens.length) break;
        const rx = parseFloat(tokens[i++]);
        const ry = parseFloat(tokens[i++]);
        const rot = parseFloat(tokens[i++]);
        const largeArc = parseFloat(tokens[i++]);
        const sweep = parseFloat(tokens[i++]);
        let x = parseFloat(tokens[i++]);
        let y = parseFloat(tokens[i++]);
        if (isRel) {
          x += curX;
          y += curY;
        }
        // Approximate arc with lineTo
        vPath.lineTo(x, y);
        curX = x;
        curY = y;
        lastCpX = curX;
        lastCpY = curY;
      } else if (cmd === 'Z') {
        vPath.closePath();
        curX = startX;
        curY = startY;
        lastCpX = curX;
        lastCpY = curY;
      } else {
        // Unrecognized or unsupported path command, skip token
        i++;
      }
    }

    return vPath;
  }

  /**
   * @private
   */
  static _getAttr(attrsStr, name) {
    const reg = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
    const m = attrsStr.match(reg);
    return m ? m[1] : null;
  }
}
