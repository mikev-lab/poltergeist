/**
 * @file xref.js
 * @description Cross-reference table and compressed stream parser for PDF files.
 * Zero-dependency, memory-safe.
 */

import zlib from 'node:zlib';
import { PdfLexer, TokenType } from './lexer.js';
import { PdfParser } from './parser.js';

export class PdfXrefTable {
  constructor() {
    /** @type {Map<number, number>} Maps objNum -> byteOffset */
    this.offsets = new Map();
    this.compressedObjects = new Map();
    /** @type {Map<number, { streamObjNum: number, index: number }>} Maps objNum -> compressed stream ref */
    this.compressedRefs = new Map();
    /** @type {Map<string, any>} */
    this.trailer = new Map();
  }

  setOffset(objNum, offset) {
    this.offsets.set(objNum, offset);
  }

  getOffset(objNum) {
    return this.offsets.get(objNum);
  }
}

export class PdfXrefParser {
  /**
   * @param {Uint8Array} bytes
   */
  constructor(bytes) {
    this.bytes = bytes;
  }

  /**
   * Locates 'startxref' near EOF and parses cross-reference structures.
   * @returns {PdfXrefTable}
   */
  parse() {
    const startXrefOffset = this._findStartXref();
    if (startXrefOffset < 0) {
      throw new Error('PDF is missing startxref marker.');
    }

    const lexer = new PdfLexer(this.bytes);
    lexer.seek(startXrefOffset);

    const token = lexer.nextToken();
    if (token.type === TokenType.KEYWORD && token.value === 'xref') {
      return this._parseClassicXref(lexer);
    } else if (token.type === TokenType.NUMBER) {
      // Compressed XRef stream: "n g obj << /Type /XRef ... >>"
      lexer.seek(startXrefOffset);
      return this._parseXrefStream(lexer);
    }

    throw new Error(`Unexpected token at startxref offset: ${token.value}`);
  }

  _findStartXref() {
    const len = this.bytes.length;
    const maxSearch = Math.min(len, 2048);
    const tail = this.bytes.subarray(len - maxSearch);
    const tailStr = new TextDecoder('latin1').decode(tail);

    const match = tailStr.lastIndexOf('startxref');
    if (match === -1) return -1;

    const after = tailStr.substring(match + 9).trim();
    const offsetStr = after.match(/^\d+/);
    if (!offsetStr) return -1;

    return parseInt(offsetStr[0], 10);
  }

  _parseClassicXref(lexer) {
    const xref = new PdfXrefTable();

    while (true) {
      const firstToken = lexer.nextToken();
      if (firstToken.type === TokenType.KEYWORD && firstToken.value === 'trailer') {
        break;
      }
      if (firstToken.type !== TokenType.NUMBER) break;

      const countToken = lexer.nextToken();
      if (countToken.type !== TokenType.NUMBER) break;

      let objNum = firstToken.value;
      const count = countToken.value;

      for (let i = 0; i < count; i++) {
        const offToken = lexer.nextToken();
        const genToken = lexer.nextToken();
        const typeToken = lexer.nextToken();

        if (typeToken.value === 'n') { // 'n' = in use
          xref.setOffset(objNum, offToken.value);
        }
        objNum++;
      }
    }

    // Parse trailer dictionary
    const parser = new PdfParser(lexer);
    const trailerDict = parser.parseObject();
    if (trailerDict instanceof Map) {
      xref.trailer = trailerDict;

      // Follow Prev pointer for incremental updates / hybrid xrefs
      let prevOffset = trailerDict.get('Prev');
      const visited = new Set();
      while (typeof prevOffset === 'number' && prevOffset > 0 && !visited.has(prevOffset)) {
        visited.add(prevOffset);
        const prevLexer = new PdfLexer(this.bytes);
        prevLexer.seek(prevOffset);
        const tok = prevLexer.nextToken();
        if (tok.type === TokenType.KEYWORD && tok.value === 'xref') {
          while (true) {
            const firstToken = prevLexer.nextToken();
            if (firstToken.type === TokenType.KEYWORD && firstToken.value === 'trailer') break;
            if (firstToken.type !== TokenType.NUMBER) break;
            const countToken = prevLexer.nextToken();
            if (countToken.type !== TokenType.NUMBER) break;
            let objNum = firstToken.value;
            const count = countToken.value;
            for (let i = 0; i < count; i++) {
              const offToken = prevLexer.nextToken();
              const genToken = prevLexer.nextToken();
              const typeToken = prevLexer.nextToken();
              if (typeToken.value === 'n' && !xref.offsets.has(objNum)) {
                xref.setOffset(objNum, offToken.value);
              }
              objNum++;
            }
          }
          const prevParser = new PdfParser(prevLexer);
          const prevTrailer = prevParser.parseObject();
          if (prevTrailer instanceof Map && prevTrailer.has('Prev')) {
            prevOffset = prevTrailer.get('Prev');
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }

    return xref;
  }

  _parseXrefStream(lexer) {
    const parser = new PdfParser(lexer);
    const indirectObj = parser.parseIndirectObject();
    if (!indirectObj || !(indirectObj.value instanceof Map)) {
      throw new Error('Failed to parse /XRef stream dictionary.');
    }

    const dict = indirectObj.value;
    const xref = new PdfXrefTable();
    xref.trailer = dict;

    const stream = indirectObj.stream;
    if (!stream) return xref;

    // Decompress stream if needed
    let data = stream;
    const filter = dict.get('Filter');
    if (filter === 'FlateDecode' || (Array.isArray(filter) && filter.includes('FlateDecode'))) {
      try {
        data = zlib.inflateSync(stream);
      } catch {
        // non-fatal
      }
    }

    // Decode W array
    const w = dict.get('W');
    if (Array.isArray(w) && w.length >= 3) {
      const [w1, w2, w3] = w;
      const entrySize = w1 + w2 + w3;
      if (entrySize > 0) {
        let indexArray = dict.get('Index');
        if (!Array.isArray(indexArray) || indexArray.length < 2) {
          const size = dict.get('Size') || 0;
          indexArray = [0, size];
        }

        let byteOffset = 0;
        for (let i = 0; i < indexArray.length; i += 2) {
          let currentObjNum = indexArray[i];
          const count = indexArray[i + 1];

          for (let j = 0; j < count; j++) {
            if (byteOffset + entrySize > data.length) break;

            let type = 1;
            if (w1 > 0) {
              type = 0;
              for (let k = 0; k < w1; k++) {
                type = (type << 8) | data[byteOffset + k];
              }
            }

            let field2 = 0;
            for (let k = 0; k < w2; k++) {
              field2 = (field2 << 8) | data[byteOffset + w1 + k];
            }

            let field3 = 0;
            for (let k = 0; k < w3; k++) {
              field3 = (field3 << 8) | data[byteOffset + w1 + w2 + k];
            }

            if (type === 1) {
              xref.setOffset(currentObjNum, field2);
            } else if (type === 2) {
              xref.compressedObjects.set(currentObjNum, {
                streamObjNum: field2,
                index: field3
              });
            }

            byteOffset += entrySize;
            currentObjNum++;
          }
        }
      }
    }

    return xref;
  }
}
