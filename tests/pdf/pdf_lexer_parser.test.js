/**
 * @file pdf_lexer_parser.test.js
 * @description Comprehensive unit tests for PDF Lexer and Parser: golden paths, deep edge cases, and adversarial syntax.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PdfLexer, TokenType } from '../../src/ingestion/pdf/lexer.js';
import { PdfParser, PdfRef } from '../../src/ingestion/pdf/parser.js';

describe('PdfLexer: Lexical Tokenization', () => {
  test('Golden Path: Tokenizes numbers, names with #xx hex escapes, keywords, and comments', () => {
    const input = Buffer.from(`
      % Header comment
      /MediaBox [ 0 0 612 792.50 -12 ]
      /Item#20Name /A#23B
      true false null
    `);

    const lexer = new PdfLexer(input);
    const tokens = [];
    let tok;
    while ((tok = lexer.nextToken()).type !== TokenType.EOF) {
      tokens.push(tok);
    }

    assert.equal(tokens[0].type, TokenType.NAME);
    assert.equal(tokens[0].value, 'MediaBox');

    assert.equal(tokens[1].type, TokenType.ARRAY_START);

    assert.equal(tokens[2].type, TokenType.NUMBER);
    assert.equal(tokens[2].value, 0);

    assert.equal(tokens[3].type, TokenType.NUMBER);
    assert.equal(tokens[3].value, 0);

    assert.equal(tokens[4].type, TokenType.NUMBER);
    assert.equal(tokens[4].value, 612);

    assert.equal(tokens[5].type, TokenType.NUMBER);
    assert.equal(tokens[5].value, 792.50);

    assert.equal(tokens[6].type, TokenType.NUMBER);
    assert.equal(tokens[6].value, -12);

    assert.equal(tokens[7].type, TokenType.ARRAY_END);

    assert.equal(tokens[8].type, TokenType.NAME);
    assert.equal(tokens[8].value, 'Item Name'); // #20 decoded to space

    assert.equal(tokens[9].type, TokenType.NAME);
    assert.equal(tokens[9].value, 'A#B'); // #23 decoded to #

    assert.equal(tokens[10].type, TokenType.BOOLEAN);
    assert.equal(tokens[10].value, true);

    assert.equal(tokens[11].type, TokenType.BOOLEAN);
    assert.equal(tokens[11].value, false);

    assert.equal(tokens[12].type, TokenType.NULL);
    assert.equal(tokens[12].value, null);
  });

  test('Golden Path: Decodes literal strings with nested parens and octal escapes', () => {
    const input = Buffer.from('(Hello \\(Nested\\) \\101\\102\\103 World\\n)');
    const lexer = new PdfLexer(input);
    const tok = lexer.nextToken();

    assert.equal(tok.type, TokenType.STRING);
    // \101\102\103 is ABC in octal, \n is newline
    assert.equal(tok.value, 'Hello (Nested) ABC World\n');
  });

  test('Golden Path: Decodes hexadecimal strings with whitespace and odd nibble padding', () => {
    const input = Buffer.from('<48 65 6C 6C 6F>'); // 'Hello'
    const lexer = new PdfLexer(input);
    const tok = lexer.nextToken();

    assert.equal(tok.type, TokenType.HEX_STRING);
    assert.equal(tok.value, 'Hello');

    // Odd number of digits: final 0 is appended per ISO 32000
    const oddInput = Buffer.from('<61 62 6>'); // 'ab' + '60' ('`')
    const oddLexer = new PdfLexer(oddInput);
    const oddTok = oddLexer.nextToken();
    assert.equal(oddTok.type, TokenType.HEX_STRING);
    assert.equal(oddTok.value, 'ab`');
  });

  test('Adversarial: Unterminated literal string throws descriptive error', () => {
    const input = Buffer.from('(Unterminated string without closing paren');
    const lexer = new PdfLexer(input);
    assert.throws(() => {
      lexer.nextToken();
    }, /Unterminated literal string/);
  });
});

describe('PdfParser: Recursive Descent Object Parsing', () => {
  test('Golden Path: Parses nested dictionaries, arrays, and indirect references', () => {
    const input = Buffer.from(`
      <<
        /Type /Pages
        /Count 2
        /Kids [ 3 0 R 4 0 R ]
        /MediaBox [ 0 0 612 792 ]
        /Parent null
      >>
    `);

    const parser = new PdfParser(input);
    const dict = parser.parseObject();

    assert.ok(dict instanceof Map);
    assert.equal(dict.get('Type'), 'Pages');
    assert.equal(dict.get('Count'), 2);

    const kids = dict.get('Kids');
    assert.ok(Array.isArray(kids));
    assert.equal(kids.length, 2);
    assert.ok(kids[0] instanceof PdfRef);
    assert.equal(kids[0].num, 3);
    assert.equal(kids[0].gen, 0);
    assert.equal(kids[1].num, 4);

    const mediaBox = dict.get('MediaBox');
    assert.deepEqual(mediaBox, [0, 0, 612, 792]);
    assert.equal(dict.get('Parent'), null);
  });

  test('Golden Path: Parses indirect objects with binary stream data', () => {
    const streamContent = 'Poltergeist Raw Stream Content 12345';
    const input = Buffer.from(`
      5 0 obj
      <<
        /Length ${streamContent.length}
        /Filter /FlateDecode
      >>
      stream
${streamContent}
      endstream
      endobj
    `);

    const parser = new PdfParser(input);
    const obj = parser.parseIndirectObject();

    assert.equal(obj.num, 5);
    assert.equal(obj.gen, 0);
    assert.ok(obj.value instanceof Map);
    assert.equal(obj.value.get('Length'), streamContent.length);
    assert.equal(obj.value.get('Filter'), 'FlateDecode');

    assert.ok(obj.stream instanceof Uint8Array);
    assert.equal(Buffer.from(obj.stream).toString('latin1').trim(), streamContent);
  });

  test('Deep Edge Case: Empty dictionaries and empty arrays', () => {
    const input = Buffer.from('<< >> [ ]');
    const parser = new PdfParser(input);

    const dict = parser.parseObject();
    assert.ok(dict instanceof Map);
    assert.equal(dict.size, 0);

    const arr = parser.parseObject();
    assert.ok(Array.isArray(arr));
    assert.equal(arr.length, 0);
  });
});
