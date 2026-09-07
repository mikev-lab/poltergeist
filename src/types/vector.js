/**
 * @file vector.js
 * @description Vector path primitives, bezier curve models, and bounding box math for Poltergeist.
 * Strictly zero-dependency and memory-safe.
 */

export const PathCommandType = Object.freeze({
  MOVE_TO: 'M',
  LINE_TO: 'L',
  CUBIC_TO: 'C',
  CLOSE: 'Z',
  CLOSE_PATH: 'Z'
});

export class PathCommand {
  /**
   * @param {string} type 'M', 'L', 'C', or 'Z'
   * @param {number[]} [args=[]]
   */
  constructor(type, args = []) {
    this.type = type;
    this.args = Object.freeze([...args]);
    Object.freeze(this);
  }

  get x() {
    if (this.type === PathCommandType.MOVE_TO || this.type === PathCommandType.LINE_TO) return this.args[0];
    if (this.type === PathCommandType.CUBIC_TO) return this.args[4];
    return 0;
  }

  get y() {
    if (this.type === PathCommandType.MOVE_TO || this.type === PathCommandType.LINE_TO) return this.args[1];
    if (this.type === PathCommandType.CUBIC_TO) return this.args[5];
    return 0;
  }

  get cp1x() {
    return this.type === PathCommandType.CUBIC_TO ? this.args[0] : 0;
  }

  get cp1y() {
    return this.type === PathCommandType.CUBIC_TO ? this.args[1] : 0;
  }

  get cp2x() {
    return this.type === PathCommandType.CUBIC_TO ? this.args[2] : 0;
  }

  get cp2y() {
    return this.type === PathCommandType.CUBIC_TO ? this.args[3] : 0;
  }
}

export class VectorPath {
  constructor() {
    this.commands = [];
    this.currentX = 0;
    this.currentY = 0;
    this.startX = 0;
    this.startY = 0;
  }

  moveTo(x, y) {
    this.commands.push(new PathCommand(PathCommandType.MOVE_TO, [x, y]));
    this.currentX = x;
    this.currentY = y;
    this.startX = x;
    this.startY = y;
    return this;
  }

  lineTo(x, y) {
    this.commands.push(new PathCommand(PathCommandType.LINE_TO, [x, y]));
    this.currentX = x;
    this.currentY = y;
    return this;
  }

  cubicTo(cp1x, cp1y, cp2x, cp2y, x, y) {
    this.commands.push(new PathCommand(PathCommandType.CUBIC_TO, [cp1x, cp1y, cp2x, cp2y, x, y]));
    this.currentX = x;
    this.currentY = y;
    return this;
  }

  /**
   * Converts quadratic Bezier to cubic Bezier curve.
   * @param {number} qx Control point X
   * @param {number} qy Control point Y
   * @param {number} x End point X
   * @param {number} y End point Y
   */
  quadTo(qx, qy, x, y) {
    const cp1x = this.currentX + (2.0 / 3.0) * (qx - this.currentX);
    const cp1y = this.currentY + (2.0 / 3.0) * (qy - this.currentY);
    const cp2x = x + (2.0 / 3.0) * (qx - x);
    const cp2y = y + (2.0 / 3.0) * (qy - y);
    return this.cubicTo(cp1x, cp1y, cp2x, cp2y, x, y);
  }

  closePath() {
    this.commands.push(new PathCommand(PathCommandType.CLOSE, []));
    this.currentX = this.startX;
    this.currentY = this.startY;
    return this;
  }

  /**
   * Computes rough bounding box of all control points [minX, minY, maxX, maxY].
   * @returns {[number, number, number, number]}
   */
  getBounds() {
    if (this.commands.length === 0) return [0, 0, 0, 0];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const cmd of this.commands) {
      const args = cmd.args;
      for (let i = 0; i < args.length; i += 2) {
        const x = args[i];
        const y = args[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    return [minX, minY, maxX, maxY];
  }

  /**
   * Bounding box object { xMin, yMin, xMax, yMax, width, height }
   */
  get bounds() {
    const [minX, minY, maxX, maxY] = this.getBounds();
    return {
      xMin: minX === Infinity ? 0 : minX,
      yMin: minY === Infinity ? 0 : minY,
      xMax: maxX === -Infinity ? 0 : maxX,
      yMax: maxY === -Infinity ? 0 : maxY,
      width: (minX === Infinity || maxX === -Infinity) ? 0 : Math.max(0, maxX - minX),
      height: (minY === Infinity || maxY === -Infinity) ? 0 : Math.max(0, maxY - minY)
    };
  }

  /**
   * Emits standard SVG path data string.
   * @returns {string}
   */
  toSvgPathData() {
    const parts = [];
    for (const cmd of this.commands) {
      if (cmd.type === PathCommandType.CLOSE) {
        parts.push('Z');
      } else {
        const formattedArgs = cmd.args.map(n => Number.isInteger(n) ? n.toString() : n.toFixed(3).replace(/\.?0+$/, ''));
        parts.push(`${cmd.type} ${formattedArgs.join(' ')}`);
      }
    }
    return parts.join(' ');
  }

  toSvgPath() {
    return this.toSvgPathData();
  }

  /**
   * Emits standard PDF path operators (m, l, c, h).
   * @returns {string}
   */
  toPdfPathData() {
    const parts = [];
    for (const cmd of this.commands) {
      if (cmd.type === PathCommandType.MOVE_TO) {
        parts.push(`${cmd.args[0].toFixed(3)} ${cmd.args[1].toFixed(3)} m`);
      } else if (cmd.type === PathCommandType.LINE_TO) {
        parts.push(`${cmd.args[0].toFixed(3)} ${cmd.args[1].toFixed(3)} l`);
      } else if (cmd.type === PathCommandType.CUBIC_TO) {
        parts.push(`${cmd.args[0].toFixed(3)} ${cmd.args[1].toFixed(3)} ${cmd.args[2].toFixed(3)} ${cmd.args[3].toFixed(3)} ${cmd.args[4].toFixed(3)} ${cmd.args[5].toFixed(3)} c`);
      } else if (cmd.type === PathCommandType.CLOSE) {
        parts.push('h');
      }
    }
    return parts.join('\n');
  }

  toPdfStream() {
    // Return space-delimited or newline-delimited PDF path commands
    return this.commands.map(cmd => {
      if (cmd.type === PathCommandType.MOVE_TO) return `${cmd.args[0]} ${cmd.args[1]} m`;
      if (cmd.type === PathCommandType.LINE_TO) return `${cmd.args[0]} ${cmd.args[1]} l`;
      if (cmd.type === PathCommandType.CUBIC_TO) return `${cmd.args[0]} ${cmd.args[1]} ${cmd.args[2]} ${cmd.args[3]} ${cmd.args[4]} ${cmd.args[5]} c`;
      if (cmd.type === PathCommandType.CLOSE) return 'h';
      return '';
    }).filter(Boolean).join(' ');
  }
}
