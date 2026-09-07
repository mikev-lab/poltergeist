/**
 * @file parser.js
 * @description Recursive descent PDF object parser for Poltergeist.
 * Strictly zero-dependency and memory-safe.
 */

import { PdfLexer, TokenType } from './lexer.js';

export class PdfRef {
  /**
   * @param {number} objNum
   * @param {number} [genNum=0]
   */
  constructor(objNum, genNum = 0) {
    this.objNum = objNum;
    this.genNum = genNum;
    this.isRef = true;
    Object.freeze(this);
  }

  get num() {
    return this.objNum;
  }

  get gen() {
    return this.genNum;
  }

  toString() {
    return `${this.objNum} ${this.genNum} R`;
  }
}

export class PdfIndirectObject {
  /**
   * @param {number} objNum
   * @param {number} genNum
   * @param {any} value
   * @param {Uint8Array|null} [stream=null]
   */
  constructor(objNum, genNum, value, stream = null) {
    this.objNum = objNum;
    this.genNum = genNum;
    this.value = value;
    this.stream = stream;
  }

  get num() {
    return this.objNum;
  }

  get gen() {
    return this.genNum;
  }
}

export class PdfParser {
  /**
   * @param {PdfLexer|Uint8Array|Buffer} lexerOrBuffer
   */
  constructor(lexerOrBuffer) {
    this.lexer = lexerOrBuffer instanceof PdfLexer ? lexerOrBuffer : new PdfLexer(lexerOrBuffer);
  }

  /**
   * Parses next PDF object value.
   * @returns {any}
   */
  parseObject() {
    const token = this.lexer.nextToken();
    if (token.type === TokenType.EOF) return null;

    if (token.type === TokenType.BOOLEAN || token.type === TokenType.NULL) {
      return token.value;
    }

    if (token.type === TokenType.NAME) {
      return token.value; // Name string
    }

    if (token.type === TokenType.STRING || token.type === TokenType.HEX_STRING) {
      return token.value;
    }

    if (token.type === TokenType.NUMBER) {
      // Lookahead: Could be indirect reference "n g R"
      const checkpoint = this.lexer.tell();
      const next1 = this.lexer.nextToken();
      if (next1.type === TokenType.NUMBER) {
        const next2 = this.lexer.nextToken();
        if (next2.type === TokenType.KEYWORD && next2.value === 'R') {
          return new PdfRef(token.value, next1.value);
        }
      }
      // Rewind if not reference
      this.lexer.seek(checkpoint);
      return token.value;
    }

    if (token.type === TokenType.KEYWORD) {
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      if (token.value === 'null') return null;
      return token.value;
    }

    if (token.type === TokenType.ARRAY_START) {
      const arr = [];
      while (true) {
        const checkpoint = this.lexer.tell();
        const next = this.lexer.nextToken();
        if (next.type === TokenType.ARRAY_END || next.type === TokenType.EOF) {
          break;
        }
        this.lexer.seek(checkpoint);
        arr.push(this.parseObject());
      }
      return arr;
    }

    if (token.type === TokenType.DICT_START) {
      const dict = new Map();
      while (true) {
        const checkpoint = this.lexer.tell();
        const keyToken = this.lexer.nextToken();
        if (keyToken.type === TokenType.DICT_END || keyToken.type === TokenType.EOF) {
          break;
        }
        if (keyToken.type !== TokenType.NAME) {
          // Non-name dictionary key encountered, abort dictionary parse
          break;
        }
        const val = this.parseObject();
        dict.set(keyToken.value, val);
      }
      return dict;
    }

    return null;
  }

  /**
   * Parses an indirect object at current lexer position:
   * "<num> <gen> obj <val> [stream ... endstream] endobj"
   * 
   * @returns {PdfIndirectObject|null}
   */
  parseIndirectObject() {
    const numToken = this.lexer.nextToken();
    if (numToken.type !== TokenType.NUMBER) return null;

    const genToken = this.lexer.nextToken();
    if (genToken.type !== TokenType.NUMBER) return null;

    const objKeyword = this.lexer.nextToken();
    if (objKeyword.type !== TokenType.KEYWORD || objKeyword.value !== 'obj') return null;

    const val = this.parseObject();
    let streamData = null;

    // Check if followed by "stream\r\n"
    this.lexer.skipWhitespaceAndComments();
    const checkpoint = this.lexer.tell();
    const streamToken = this.lexer.nextToken();

    if (streamToken.type === TokenType.KEYWORD && streamToken.value === 'stream') {
      // In PDF, stream data starts right after \r\n or \n following 'stream'
      let streamStart = this.lexer.tell();
      if (this.lexer.bytes[streamStart] === 0x0d && this.lexer.bytes[streamStart + 1] === 0x0a) {
        streamStart += 2;
      } else if (this.lexer.bytes[streamStart] === 0x0a) {
        streamStart += 1;
      }

      // Read stream length from dictionary if available, or scan for endstream
      let streamLen = -1;
      if (val instanceof Map && typeof val.get('Length') === 'number') {
        streamLen = val.get('Length');
      }

      if (streamLen >= 0 && streamStart + streamLen <= this.lexer.len) {
        streamData = this.lexer.bytes.subarray(streamStart, streamStart + streamLen);
        this.lexer.seek(streamStart + streamLen);
      } else {
        // Search for 'endstream'
        let p = streamStart;
        while (p + 9 <= this.lexer.len) {
          if (
            this.lexer.bytes[p] === 0x65 && // e
            this.lexer.bytes[p + 1] === 0x6e && // n
            this.lexer.bytes[p + 2] === 0x64 && // d
            this.lexer.bytes[p + 3] === 0x73 && // s
            this.lexer.bytes[p + 4] === 0x74 && // t
            this.lexer.bytes[p + 5] === 0x72 && // r
            this.lexer.bytes[p + 6] === 0x65 && // e
            this.lexer.bytes[p + 7] === 0x61 && // a
            this.lexer.bytes[p + 8] === 0x6d    // m
          ) {
            let actualEnd = p;
            if (this.lexer.bytes[actualEnd - 1] === 0x0a) actualEnd--;
            if (this.lexer.bytes[actualEnd - 1] === 0x0d) actualEnd--;
            streamData = this.lexer.bytes.subarray(streamStart, actualEnd);
            this.lexer.seek(p + 9);
            break;
          }
          p++;
        }
      }
    } else {
      this.lexer.seek(checkpoint);
    }

    return new PdfIndirectObject(numToken.value, genToken.value, val, streamData);
  }
}
