/**
 * @file clip_decoder.test.js
 * @description Comprehensive unit tests for zero-dependency SQLite reader and Clip Studio Paint (.clip) ingestion.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteReader, readVarint } from '../../src/ingestion/layered/clip/sqlite_reader.js';
import { ClipDecoder } from '../../src/ingestion/layered/clip/clip_decoder.js';

/**
 * Encodes a JavaScript number into a SQLite variable-length integer (varint).
 */
function encodeVarint(val) {
  if (val < 0x80) {
    return [val];
  }
  const bytes = [];
  let n = val;
  bytes.unshift(n & 0x7f);
  n >>>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  return bytes;
}

/**
 * Builds a SQLite record payload from an array of JS values.
 * Supported types: null, int (8/16/32), float, string, Uint8Array (blob)
 */
function buildSqliteRecord(values) {
  const serialTypes = [];
  const bodyBufs = [];

  for (const v of values) {
    if (v === null || v === undefined) {
      serialTypes.push(0);
    } else if (typeof v === 'number') {
      if (Number.isInteger(v)) {
        if (v === 0) {
          serialTypes.push(8);
        } else if (v === 1) {
          serialTypes.push(9);
        } else if (v >= -128 && v <= 127) {
          serialTypes.push(1);
          bodyBufs.push(Buffer.from([v & 0xff]));
        } else if (v >= -32768 && v <= 32767) {
          serialTypes.push(2);
          const b = Buffer.alloc(2);
          b.writeInt16BE(v, 0);
          bodyBufs.push(b);
        } else {
          serialTypes.push(4);
          const b = Buffer.alloc(4);
          b.writeInt32BE(v, 0);
          bodyBufs.push(b);
        }
      } else {
        serialTypes.push(7);
        const b = Buffer.alloc(8);
        b.writeDoubleBE(v, 0);
        bodyBufs.push(b);
      }
    } else if (typeof v === 'string') {
      const strBuf = Buffer.from(v, 'utf8');
      const st = strBuf.length * 2 + 13;
      serialTypes.push(st);
      bodyBufs.push(strBuf);
    } else if (v instanceof Uint8Array) {
      const st = v.length * 2 + 12;
      serialTypes.push(st);
      bodyBufs.push(Buffer.from(v));
    }
  }

  // Header = header_size varint + serial_type varints
  let stBytes = [];
  for (const st of serialTypes) {
    stBytes = stBytes.concat(encodeVarint(st));
  }
  const headerLenVarint = encodeVarint(stBytes.length + 1); // approximate length
  const headerBuf = Buffer.concat([Buffer.from(headerLenVarint), Buffer.from(stBytes)]);
  const bodyBuf = Buffer.concat(bodyBufs);

  return Buffer.concat([headerBuf, bodyBuf]);
}

/**
 * Builds a synthetic 2-page SQLite 3 database containing sqlite_master and a table.
 */
function buildSyntheticSqliteClipDb() {
  const pageSize = 4096;
  const db = Buffer.alloc(pageSize * 2);

  // 1. Page 1: Header (100 bytes)
  db.write('SQLite format 3\0', 0, 'ascii');
  db.writeUInt16BE(pageSize, 16);
  db.writeUInt8(1, 18); // write version
  db.writeUInt8(1, 19); // read version
  db.writeUInt8(0, 20); // reserved
  db.writeUInt32BE(1, 24); // change counter
  db.writeUInt32BE(2, 28); // db size in pages

  // Page 1 B-Tree header at offset 100: Table Leaf (0x0D)
  db.writeUInt8(0x0d, 100);
  db.writeUInt16BE(0, 101); // freeblock
  db.writeUInt16BE(1, 103); // 1 cell in sqlite_master
  // Cell starts near end of Page 1
  const cell1Offset = 3800;
  db.writeUInt16BE(cell1Offset, 105); // content area start
  db.writeUInt8(0, 107); // fragmented free bytes
  db.writeUInt16BE(cell1Offset, 108); // Cell 0 pointer

  // Cell 0 in sqlite_master: ['table', 'Canvas', 'Canvas', 2, 'CREATE TABLE Canvas(...)']
  const masterPayload = buildSqliteRecord(['table', 'Canvas', 'Canvas', 2, 'CREATE TABLE Canvas (w int, h int, dpi int)']);
  const payloadSizeVarint = Buffer.from(encodeVarint(masterPayload.length));
  const rowIdVarint = Buffer.from(encodeVarint(1));
  const cell0 = Buffer.concat([payloadSizeVarint, rowIdVarint, masterPayload]);
  cell0.copy(db, cell1Offset);

  // 2. Page 2: Table Leaf (0x0D) for 'Canvas' table (rootpage = 2)
  const p2Offset = pageSize;
  db.writeUInt8(0x0d, p2Offset + 0);
  db.writeUInt16BE(0, p2Offset + 1);
  db.writeUInt16BE(1, p2Offset + 3); // 1 cell
  const p2CellOffset = pageSize + 3500;
  db.writeUInt16BE(3500, p2Offset + 5);
  db.writeUInt8(0, p2Offset + 7);
  db.writeUInt16BE(3500, p2Offset + 8); // Cell 0 pointer relative to page start

  // Row in Canvas: [id=1, width=1920, height=1080, dpi=300]
  const canvasPayload = buildSqliteRecord([1, 1920, 1080, 300]);
  const p2SizeVarint = Buffer.from(encodeVarint(canvasPayload.length));
  const p2RowId = Buffer.from(encodeVarint(1));
  const canvasCell = Buffer.concat([p2SizeVarint, p2RowId, canvasPayload]);
  canvasCell.copy(db, p2CellOffset);

  return db;
}

describe('SqliteReader: Pure Native SQLite 3 Database Parser', () => {
  it('readVarint: Correctly reads 1-byte, 2-byte, and multi-byte varints', () => {
    // Single byte (0..127)
    const v1 = readVarint(new Uint8Array([0x42]), 0);
    assert.strictEqual(v1.value, 0x42);
    assert.strictEqual(v1.bytesRead, 1);

    // Two bytes: 300 = (2 * 128) + 44 -> 0x82, 0x2c
    const v2 = readVarint(new Uint8Array([0x82, 0x2c]), 0);
    assert.strictEqual(v2.value, 300);
    assert.strictEqual(v2.bytesRead, 2);
  });

  it('Parses table catalog and retrieves rows from Table B-Tree pages', () => {
    const dbBytes = buildSyntheticSqliteClipDb();
    const reader = new SqliteReader(dbBytes);

    assert.strictEqual(reader.pageSize, 4096);
    assert.ok(reader.tables.has('Canvas'), 'Canvas table discovered in sqlite_master');
    assert.strictEqual(reader.tables.get('Canvas'), 2);

    const canvasRows = reader.readTableRows(2);
    assert.strictEqual(canvasRows.length, 1);
    const row = canvasRows[0];
    assert.strictEqual(row[0], 1);    // id
    assert.strictEqual(row[1], 1920); // width
    assert.strictEqual(row[2], 1080); // height
    assert.strictEqual(row[3], 300);  // dpi
  });

  it('Adversarial: Rejects buffer with invalid magic header', () => {
    const fake = Buffer.alloc(200);
    fake.write('NotSQLite3DB', 0, 'ascii');
    assert.throws(() => {
      new SqliteReader(fake);
    }, /Invalid SQLite header/);
  });

  it('Adversarial: Rejects truncated buffer under 100 bytes', () => {
    assert.throws(() => {
      new SqliteReader(new Uint8Array(50));
    }, /Buffer too small/);
  });
});

describe('ClipDecoder: Clip Studio Paint Ingestion', () => {
  it('Extracts canvas dimensions and DPI from Clip Studio Paint database', () => {
    const dbBytes = buildSyntheticSqliteClipDb();
    const layered = ClipDecoder.decode(dbBytes);

    assert.strictEqual(layered.width, 1920);
    assert.strictEqual(layered.height, 1080);
    assert.strictEqual(layered.resolution.dpiX, 300);
    assert.strictEqual(layered.resolution.dpiY, 300);
  });
});
