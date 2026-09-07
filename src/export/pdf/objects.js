/**
 * @file objects.js
 * @description Low-level PDF object primitives and serializers for Poltergeist.
 * Strictly zero-dependency and memory-safe.
 */

import zlib from 'node:zlib';

export class PdfName {
  constructor(name) {
    this.name = name.startsWith('/') ? name.substring(1) : name;
    Object.freeze(this);
  }

  toString() {
    return `/${this.name}`;
  }
}

export class PdfString {
  constructor(value, isHex = false) {
    this.value = value;
    this.isHex = isHex;
    Object.freeze(this);
  }

  toString() {
    if (this.isHex) {
      return `<${this.value}>`;
    }
    // Escape parentheses and backslashes
    const escaped = String(this.value)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
    return `(${escaped})`;
  }
}

export class PdfReference {
  constructor(num, gen = 0) {
    this.num = num;
    this.gen = gen;
    Object.freeze(this);
  }

  toString() {
    return `${this.num} ${this.gen} R`;
  }
}

export class PdfArray {
  constructor(elements = []) {
    this.elements = [...elements];
  }

  add(elem) {
    this.elements.push(elem);
    return this;
  }

  toString() {
    return `[ ${this.elements.map(serializePdfValue).join(' ')} ]`;
  }
}

export class PdfDictionary {
  constructor(initial = {}) {
    this.map = new Map();
    for (const [k, v] of Object.entries(initial)) {
      this.set(k, v);
    }
  }

  set(key, val) {
    const k = key.startsWith('/') ? key.substring(1) : key;
    this.map.set(k, val);
    return this;
  }

  get(key) {
    const k = key.startsWith('/') ? key.substring(1) : key;
    return this.map.get(k);
  }

  has(key) {
    const k = key.startsWith('/') ? key.substring(1) : key;
    return this.map.has(k);
  }

  toString() {
    let s = '<<\n';
    for (const [k, v] of this.map.entries()) {
      s += `  /${k} ${serializePdfValue(v)}\n`;
    }
    s += '>>';
    return s;
  }
}

export class PdfStream {
  /**
   * @param {PdfDictionary} dict 
   * @param {Uint8Array} data 
   * @param {boolean} [compress=true]
   */
  constructor(dict = new PdfDictionary(), data = new Uint8Array(), compress = true) {
    this.dict = dict;
    if (compress && data.length > 0) {
      const compressed = zlib.deflateSync(data);
      this.dict.set('Filter', new PdfName('FlateDecode'));
      this.dict.set('Length', compressed.length);
      this.data = compressed;
    } else {
      this.dict.set('Length', data.length);
      this.data = data;
    }
  }
}

export function serializePdfValue(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toString() : v.toFixed(4).replace(/\.?0+$/, '');
  }
  if (typeof v === 'string') return new PdfString(v).toString();
  if (v instanceof PdfName || v instanceof PdfString || v instanceof PdfReference ||
      v instanceof PdfArray || v instanceof PdfDictionary) {
    return v.toString();
  }
  return String(v);
}
