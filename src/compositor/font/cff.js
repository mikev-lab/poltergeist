/**
 * @file cff.js
 * @description Compact Font Format (CFF) and Type 2 CharString decompiler for OpenType fonts.
 * Converts PostScript glyph instructions directly to VectorPath primitives.
 * Zero-dependency, memory-safe.
 */

import { VectorPath } from '../../types/vector.js';

export class CffCharStringDecompiler {
  /**
   * Decompiles a Type 2 CharString byte array into a VectorPath.
   * @param {Uint8Array} bytes
   * @param {object} [options]
   * @param {Array<Uint8Array>} [options.localSubrs]
   * @param {Array<Uint8Array>} [options.globalSubrs]
   * @returns {VectorPath}
   */
  static decompile(bytes, options = {}) {
    const path = new VectorPath();
    const stack = [];
    let curX = 0;
    let curY = 0;
    let ip = 0;
    const len = bytes.length;

    while (ip < len) {
      const b0 = bytes[ip++];

      if (b0 >= 32 && b0 <= 246) {
        // Integer: b0 - 139
        stack.push(b0 - 139);
      } else if (b0 >= 247 && b0 <= 250) {
        const b1 = bytes[ip++];
        stack.push((b0 - 247) * 256 + b1 + 108);
      } else if (b0 >= 251 && b0 <= 254) {
        const b1 = bytes[ip++];
        stack.push(-(b0 - 251) * 256 - b1 - 108);
      } else if (b0 === 28) {
        // 16-bit signed integer
        const b1 = bytes[ip++];
        const b2 = bytes[ip++];
        let val = (b1 << 8) | b2;
        if (val & 0x8000) val -= 0x10000;
        stack.push(val);
      } else if (b0 === 255) {
        // 16.16 fixed point
        const b1 = bytes[ip++];
        const b2 = bytes[ip++];
        const b3 = bytes[ip++];
        const b4 = bytes[ip++];
        let val = (b1 << 24) | (b2 << 16) | (b3 << 8) | b4;
        stack.push(val / 65536);
      } else if (b0 === 12) {
        // Two-byte operator
        const b1 = bytes[ip++];
        // Math / conditional operators
        if (b1 === 9) { // abs
          const v = stack.pop();
          stack.push(Math.abs(v));
        } else if (b1 === 10) { // add
          const v2 = stack.pop();
          const v1 = stack.pop();
          stack.push(v1 + v2);
        } else if (b1 === 11) { // sub
          const v2 = stack.pop();
          const v1 = stack.pop();
          stack.push(v1 - v2);
        } else if (b1 === 12) { // div
          const v2 = stack.pop();
          const v1 = stack.pop();
          stack.push(v1 / v2);
        } else if (b1 === 14) { // neg
          const v = stack.pop();
          stack.push(-v);
        } else {
          // Unhandled 2-byte operator, clear stack
          stack.length = 0;
        }
      } else {
        // 1-byte operators
        switch (b0) {
          case 21: { // rmoveto (dx1, dy1)
            if (stack.length >= 2) {
              const dy = stack.pop();
              const dx = stack.pop();
              curX += dx;
              curY += dy;
              path.moveTo(curX, curY);
            }
            stack.length = 0;
            break;
          }
          case 22: { // hmoveto (dx1)
            if (stack.length >= 1) {
              const dx = stack.pop();
              curX += dx;
              path.moveTo(curX, curY);
            }
            stack.length = 0;
            break;
          }
          case 4: { // vmoveto (dy1)
            if (stack.length >= 1) {
              const dy = stack.pop();
              curY += dy;
              path.moveTo(curX, curY);
            }
            stack.length = 0;
            break;
          }
          case 5: { // rlineto {dxa dya}+
            for (let i = 0; i < stack.length - 1; i += 2) {
              curX += stack[i];
              curY += stack[i + 1];
              path.lineTo(curX, curY);
            }
            stack.length = 0;
            break;
          }
          case 6: { // hlineto
            let isH = true;
            for (let i = 0; i < stack.length; i++) {
              if (isH) {
                curX += stack[i];
              } else {
                curY += stack[i];
              }
              path.lineTo(curX, curY);
              isH = !isH;
            }
            stack.length = 0;
            break;
          }
          case 7: { // vlineto
            let isV = true;
            for (let i = 0; i < stack.length; i++) {
              if (isV) {
                curY += stack[i];
              } else {
                curX += stack[i];
              }
              path.lineTo(curX, curY);
              isV = !isV;
            }
            stack.length = 0;
            break;
          }
          case 8: { // rrcurveto {dxa dya dxb dyb dxc dyc}+
            for (let i = 0; i < stack.length - 5; i += 6) {
              const cp1x = curX + stack[i];
              const cp1y = curY + stack[i + 1];
              const cp2x = cp1x + stack[i + 2];
              const cp2y = cp1y + stack[i + 3];
              curX = cp2x + stack[i + 4];
              curY = cp2y + stack[i + 5];
              path.cubicTo(cp1x, cp1y, cp2x, cp2y, curX, curY);
            }
            stack.length = 0;
            break;
          }
          case 14: { // endchar
            path.closePath();
            stack.length = 0;
            return path;
          }
          case 1:  // hstem
          case 3:  // vstem
          case 18: // hstemhm
          case 23: // vstemhm
          case 19: // hintmask
          case 20: // cntrmask
            // Stem hinting operators: discard hints for pure geometric outline extraction
            stack.length = 0;
            break;
          default:
            stack.length = 0;
            break;
        }
      }
    }

    if (path.commands.length > 0) {
      path.closePath();
    }
    return path;
  }
}
