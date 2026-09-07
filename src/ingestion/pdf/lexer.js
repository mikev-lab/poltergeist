/**
 * @file lexer.js
 * @description High-speed lexical tokenizer for PDF 1.3 through 2.0 binary streams.
 * Zero-dependency, memory-safe.
 */

export const TokenType = Object.freeze({
  KEYWORD: 'keyword',
  BOOLEAN: 'boolean',
  NULL: 'null',
  NUMBER: 'number',
  STRING: 'string',
  HEX_STRING: 'hex_string',
  NAME: 'name',
  DICT_START: 'dict_start', // <<
  DICT_END: 'dict_end',     // >>
  ARRAY_START: 'array_start', // [
  ARRAY_END: 'array_end',     // ]
  EOF: 'eof'
});

export class Token {
  /**
   * @param {string} type
   * @param {any} value
   * @param {number} offset
   */
  constructor(type, value, offset = 0) {
    this.type = type;
    this.value = value;
    this.offset = offset;
  }
}

export class PdfLexer {
  /**
   * @param {Uint8Array|Buffer|import('../../io/seekable.js').SeekableSource} buffer
   */
  constructor(buffer) {
    if (buffer && typeof buffer === 'object' && ('subarray' in buffer && 'length' in buffer)) {
      this.bytes = buffer;
      this.len = buffer.length;
    } else {
      this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      this.len = this.bytes.length;
    }
    this.pos = 0;
  }

  seek(offset) {
    this.pos = Math.max(0, Math.min(this.len, offset));
  }

  tell() {
    return this.pos;
  }

  isWhitespace(b) {
    return b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;
  }

  isDelimiter(b) {
    return (
      this.isWhitespace(b) ||
      b === 0x28 || b === 0x29 || // ( )
      b === 0x3c || b === 0x3e || // < >
      b === 0x5b || b === 0x5d || // [ ]
      b === 0x2f || b === 0x25    // / %
    );
  }

  skipWhitespaceAndComments() {
    while (this.pos < this.len) {
      const b = this.bytes[this.pos];
      if (this.isWhitespace(b)) {
        this.pos++;
        continue;
      }
      if (b === 0x25) { // '%' Comment
        this.pos++;
        while (this.pos < this.len && this.bytes[this.pos] !== 0x0a && this.bytes[this.pos] !== 0x0d) {
          this.pos++;
        }
        continue;
      }
      break;
    }
  }

  /**
   * Scans and returns next token.
   * @returns {Token}
   */
  nextToken() {
    this.skipWhitespaceAndComments();

    if (this.pos >= this.len) {
      return new Token(TokenType.EOF, null, this.pos);
    }

    const startPos = this.pos;
    const b = this.bytes[this.pos];

    // Delimiters
    if (b === 0x3c) { // '<'
      if (this.pos + 1 < this.len && this.bytes[this.pos + 1] === 0x3c) { // '<<'
        this.pos += 2;
        return new Token(TokenType.DICT_START, '<<', startPos);
      }
      // Hex string: <...>
      return this._readHexString(startPos);
    }

    if (b === 0x3e) { // '>'
      if (this.pos + 1 < this.len && this.bytes[this.pos + 1] === 0x3e) { // '>>'
        this.pos += 2;
        return new Token(TokenType.DICT_END, '>>', startPos);
      }
      this.pos++;
      return new Token(TokenType.KEYWORD, '>', startPos);
    }

    if (b === 0x5b) { // '['
      this.pos++;
      return new Token(TokenType.ARRAY_START, '[', startPos);
    }

    if (b === 0x5d) { // ']'
      this.pos++;
      return new Token(TokenType.ARRAY_END, ']', startPos);
    }

    // Literal String: (...)
    if (b === 0x28) {
      return this._readLiteralString(startPos);
    }

    // Name: /Name
    if (b === 0x2f) {
      return this._readName(startPos);
    }

    // Number or Keyword
    return this._readNumberOrKeyword(startPos);
  }

  _readLiteralString(startPos) {
    this.pos++; // Skip opening '('
    let depth = 1;
    const chars = [];

    while (this.pos < this.len && depth > 0) {
      const c = this.bytes[this.pos++];
      if (c === 0x5c) { // Escape '\'
        if (this.pos >= this.len) break;
        const esc = this.bytes[this.pos++];
        if (esc === 0x6e) chars.push(0x0a); // \n
        else if (esc === 0x72) chars.push(0x0d); // \r
        else if (esc === 0x74) chars.push(0x09); // \t
        else if (esc === 0x62) chars.push(0x08); // \b
        else if (esc === 0x66) chars.push(0x0c); // \f
        else if (esc === 0x5c) chars.push(0x5c); // \\
        else if (esc === 0x28) chars.push(0x28); // \(
        else if (esc === 0x29) chars.push(0x29); // \)
        else if (esc >= 0x30 && esc <= 0x37) { // Octal \ddd
          let octal = esc - 0x30;
          for (let k = 0; k < 2 && this.pos < this.len; k++) {
            const next = this.bytes[this.pos];
            if (next >= 0x30 && next <= 0x37) {
              octal = (octal << 3) | (next - 0x30);
              this.pos++;
            } else break;
          }
          chars.push(octal & 0xff);
        } else {
          chars.push(esc);
        }
      } else if (c === 0x28) { // '('
        depth++;
        chars.push(c);
      } else if (c === 0x29) { // ')'
        depth--;
        if (depth > 0) chars.push(c);
      } else {
        chars.push(c);
      }
    }

    if (depth > 0) {
      throw new Error(`Unterminated literal string at offset ${startPos}`);
    }

    return new Token(TokenType.STRING, new TextDecoder('latin1').decode(new Uint8Array(chars)), startPos);
  }

  _readHexString(startPos) {
    this.pos++; // Skip '<'
    let hex = '';
    while (this.pos < this.len) {
      const c = this.bytes[this.pos++];
      if (c === 0x3e) break; // '>'
      if (!this.isWhitespace(c)) {
        hex += String.fromCharCode(c);
      }
    }
    if (hex.length % 2 !== 0) hex += '0';

    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16) || 0;
    }
    return new Token(TokenType.HEX_STRING, new TextDecoder('latin1').decode(bytes), startPos);
  }

  _readName(startPos) {
    this.pos++; // Skip '/'
    let name = '';
    while (this.pos < this.len) {
      const c = this.bytes[this.pos];
      if (this.isDelimiter(c)) break;
      this.pos++;
      if (c === 0x23 && this.pos + 2 <= this.len) { // '#xx' hex escape
        const hex = String.fromCharCode(this.bytes[this.pos], this.bytes[this.pos + 1]);
        const val = parseInt(hex, 16);
        if (!isNaN(val)) {
          name += String.fromCharCode(val);
          this.pos += 2;
          continue;
        }
      }
      name += String.fromCharCode(c);
    }
    return new Token(TokenType.NAME, name, startPos);
  }

  _readNumberOrKeyword(startPos) {
    let str = '';
    while (this.pos < this.len) {
      const c = this.bytes[this.pos];
      if (this.isDelimiter(c)) break;
      str += String.fromCharCode(c);
      this.pos++;
    }

    // Check if integer or float
    if (/^[+-]?\d+$/.test(str)) {
      return new Token(TokenType.NUMBER, parseInt(str, 10), startPos);
    }
    if (/^[+-]?(\d+\.\d*|\.\d+)$/.test(str)) {
      return new Token(TokenType.NUMBER, parseFloat(str), startPos);
    }

    if (str === 'true') {
      return new Token(TokenType.BOOLEAN, true, startPos);
    }
    if (str === 'false') {
      return new Token(TokenType.BOOLEAN, false, startPos);
    }
    if (str === 'null') {
      return new Token(TokenType.NULL, null, startPos);
    }

    return new Token(TokenType.KEYWORD, str, startPos);
  }
}
