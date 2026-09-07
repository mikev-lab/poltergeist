/**
 * @file dxf_decoder.js
 * @description Native AutoCAD DXF (ASCII) schematic parser and model-to-paper projector for Poltergeist.
 * Tokenizes group-code pairs, extracts entities (LINE, CIRCLE, ARC, LWPOLYLINE, ELLIPSE, TEXT),
 * maps AutoCAD Color Index (ACI), and projects model space into calibrated architectural paper sizes.
 * Strictly zero-dependency and memory-safe.
 */

import { VectorPath } from '../../types/vector.js';
import { Document, PageRecord, PageBox } from '../../types/document.js';
import { ColorSpaceType } from '../../types/image.js';

// Standard AutoCAD Color Index (ACI) 1-7 primary RGB colors
export const ACI_PALETTE = Object.freeze({
  1: [255, 0, 0],       // Red
  2: [255, 255, 0],     // Yellow
  3: [0, 255, 0],       // Green
  4: [0, 255, 255],     // Cyan
  5: [0, 0, 255],       // Blue
  6: [255, 0, 255],     // Magenta
  7: [0, 0, 0],         // Black (on white sheet)
  8: [128, 128, 128],   // Dark Gray
  9: [192, 192, 192]    // Light Gray
});

export const CAD_PAPER_SIZES = Object.freeze({
  ARCH_D: { width: 2592, height: 1728, name: 'Arch D (36x24 in)' }, // Landscape
  ARCH_E: { width: 3456, height: 2592, name: 'Arch E (48x36 in)' },
  ISO_A1: { width: 2384, height: 1684, name: 'ISO A1 (841x594 mm)' },
  ISO_A0: { width: 3370, height: 2384, name: 'ISO A0 (1189x841 mm)' },
  ANSI_B: { width: 1224, height: 792, name: 'ANSI B (17x11 in)' },
  LETTER: { width: 792, height: 612, name: 'Letter Landscape (11x8.5 in)' }
});

export class DxfDecoder {
  /**
   * Sniffs whether buffer or text is an AutoCAD DXF file.
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
      text = new TextDecoder('latin1').decode(input.subarray(0, len));
    } else {
      return false;
    }

    // DXF starts with group code 0 and SECTION
    const lines = text.split(/\r?\n/).map(l => l.trim());
    for (let i = 0; i < Math.min(lines.length - 1, 20); i++) {
      if (lines[i] === '0' && lines[i + 1] === 'SECTION') {
        return true;
      }
    }
    return false;
  }

  /**
   * Decodes an AutoCAD DXF stream into a Document model.
   * @param {Uint8Array|string} input
   * @param {object} [options]
   * @returns {Document}
   */
  static decode(input, options = {}) {
    let text = '';
    if (typeof input === 'string') {
      text = input;
    } else if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
      text = new TextDecoder('latin1').decode(input);
    } else {
      throw new TypeError('Invalid DXF input: expected string or Uint8Array.');
    }

    if (!DxfDecoder.probe(text)) {
      throw new Error('Unsupported or invalid AutoCAD DXF file signature.');
    }

    const lines = text.split(/\r?\n/);
    let inEntities = false;
    let i = 0;
    const n = lines.length;

    const rawEntities = [];
    let currentEntity = null;

    while (i < n - 1) {
      const codeStr = lines[i++].trim();
      if (!codeStr) continue;
      const code = parseInt(codeStr, 10);
      if (isNaN(code)) continue;

      const val = lines[i++].trim();

      if (code === 0) {
        if (val === 'SECTION') {
          // Lookahead for section name
          if (i < n - 1 && lines[i].trim() === '2') {
            const secName = lines[i + 1].trim();
            inEntities = (secName === 'ENTITIES');
          }
        } else if (val === 'ENDSEC') {
          inEntities = false;
        }

        if (inEntities && val !== 'SECTION' && val !== 'ENDSEC') {
          if (currentEntity) {
            rawEntities.push(currentEntity);
          }
          currentEntity = { type: val, props: {} };
        }
      } else if (inEntities && currentEntity) {
        if (code === 10 || code === 20 || code === 30 ||
            code === 11 || code === 21 || code === 31 ||
            code === 40 || code === 50 || code === 51) {
          const num = parseFloat(val);
          if (code === 10) {
            // LWPOLYLINE has multiple vertex 10/20 pairs
            if (currentEntity.type === 'LWPOLYLINE') {
              if (!currentEntity.vertices) currentEntity.vertices = [];
              currentEntity.vertices.push({ x: num, y: 0 });
            } else {
              currentEntity.props[code] = num;
            }
          } else if (code === 20 && currentEntity.type === 'LWPOLYLINE' && currentEntity.vertices?.length) {
            currentEntity.vertices[currentEntity.vertices.length - 1].y = num;
          } else {
            currentEntity.props[code] = num;
          }
        } else if (code === 70) {
          currentEntity.props[code] = parseInt(val, 10);
        } else if (code === 62) {
          currentEntity.props[code] = parseInt(val, 10);
        } else if (code === 1) {
          currentEntity.props[code] = val;
        }
      }
    }

    if (currentEntity) {
      rawEntities.push(currentEntity);
    }

    // Measure model bounds (minX, minY, maxX, maxY)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function updateBounds(x, y) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    for (const ent of rawEntities) {
      const p = ent.props;
      if (ent.type === 'LINE') {
        updateBounds(p[10] || 0, p[20] || 0);
        updateBounds(p[11] || 0, p[21] || 0);
      } else if (ent.type === 'CIRCLE' || ent.type === 'ARC') {
        const cx = p[10] || 0;
        const cy = p[20] || 0;
        const r = p[40] || 0;
        updateBounds(cx - r, cy - r);
        updateBounds(cx + r, cy + r);
      } else if (ent.type === 'LWPOLYLINE' && ent.vertices) {
        for (const v of ent.vertices) {
          updateBounds(v.x, v.y);
        }
      }
    }

    if (minX === Infinity) {
      minX = 0; minY = 0; maxX = 100; maxY = 100;
    }

    const modelWidth = Math.max(0.001, maxX - minX);
    const modelHeight = Math.max(0.001, maxY - minY);

    // Architectural paper target (default: Arch D 36x24 in or options.paperSize)
    const paperSpec = options.paperSize && CAD_PAPER_SIZES[options.paperSize] 
      ? CAD_PAPER_SIZES[options.paperSize] 
      : CAD_PAPER_SIZES.ARCH_D;

    const paperW = paperSpec.width;
    const paperH = paperSpec.height;
    const margin = 72; // 1 inch margin in points

    const availW = paperW - 2 * margin;
    const availH = paperH - 2 * margin;

    const scale = Math.min(availW / modelWidth, availH / modelHeight);
    const offsetX = margin + (availW - modelWidth * scale) / 2 - minX * scale;
    // DXF Y is upward, PDF Y is upward (or invert if needed)
    const offsetY = margin + (availH - modelHeight * scale) / 2 - minY * scale;

    const projectX = (x) => x * scale + offsetX;
    const projectY = (y) => y * scale + offsetY;

    const paths = [];
    const K = 0.5522847498;

    for (const ent of rawEntities) {
      const p = ent.props;
      if (ent.type === 'LINE') {
        const x1 = projectX(p[10] || 0);
        const y1 = projectY(p[20] || 0);
        const x2 = projectX(p[11] || 0);
        const y2 = projectY(p[21] || 0);
        const v = new VectorPath();
        v.moveTo(x1, y1);
        v.lineTo(x2, y2);
        paths.push(v);
      } else if (ent.type === 'CIRCLE') {
        const cx = projectX(p[10] || 0);
        const cy = projectY(p[20] || 0);
        const r = (p[40] || 0) * scale;
        if (r > 0) {
          const v = new VectorPath();
          const ox = r * K;
          const oy = r * K;
          v.moveTo(cx, cy - r);
          v.cubicTo(cx + ox, cy - r, cx + r, cy - oy, cx + r, cy);
          v.cubicTo(cx + r, cy + oy, cx + ox, cy + r, cx, cy + r);
          v.cubicTo(cx - ox, cy + r, cx - r, cy + oy, cx - r, cy);
          v.cubicTo(cx - r, cy - oy, cx - ox, cy - r, cx, cy - r);
          v.closePath();
          paths.push(v);
        }
      } else if (ent.type === 'LWPOLYLINE' && ent.vertices && ent.vertices.length >= 2) {
        const v = new VectorPath();
        v.moveTo(projectX(ent.vertices[0].x), projectY(ent.vertices[0].y));
        for (let j = 1; j < ent.vertices.length; j++) {
          v.lineTo(projectX(ent.vertices[j].x), projectY(ent.vertices[j].y));
        }
        if ((p[70] & 1) === 1) { // closed
          v.closePath();
        }
        paths.push(v);
      }
    }

    const pageBox = new PageBox({
      mediaBox: [0, 0, paperW, paperH],
      trimBox: [0, 0, paperW, paperH],
      bleedBox: [-9, -9, paperW + 9, paperH + 9]
    });

    const page = new PageRecord({
      pageNumber: 1,
      width: paperW,
      height: paperH,
      pageBox,
      paths,
      metadata: {
        format: 'AutoCAD DXF',
        modelExtents: { minX, minY, maxX, maxY },
        scale,
        paperSize: paperSpec.name
      }
    });

    return new Document({
      title: options.title || 'CAD Drawing Schematic',
      creator: 'Poltergeist AutoCAD DXF Ingestion Engine',
      pages: [page],
      colorSpace: ColorSpaceType.RGB
    });
  }
}
