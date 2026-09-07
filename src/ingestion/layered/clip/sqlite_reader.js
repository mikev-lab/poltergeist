/**
 * @file sqlite_reader.js
 * @description Pure native, zero-dependency SQLite 3 B-Tree database reader for Poltergeist.
 * Memory-safe, traverses SQLite pages, varints, and record payloads to query tables.
 */

const SQLITE_MAGIC = 'SQLite format 3\0';

/**
 * Reads a SQLite variable-length integer (varint, 1-9 bytes).
 * @param {Uint8Array} bytes 
 * @param {number} offset 
 * @returns {{ value: number, bytesRead: number }}
 */
export function readVarint(bytes, offset) {
  let value = 0;
  let bytesRead = 0;

  for (let i = 0; i < 8; i++) {
    if (offset + i >= bytes.length) break;
    const b = bytes[offset + i];
    bytesRead++;
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) {
      return { value, bytesRead };
    }
  }

  // 9th byte uses all 8 bits
  if (offset + 8 < bytes.length) {
    const b = bytes[offset + 8];
    bytesRead++;
    value = (value << 8) | b;
  }

  return { value, bytesRead };
}

export class SqliteReader {
  /**
   * @param {Uint8Array} bytes 
   */
  constructor(bytes) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);

    // Validate 16-byte magic
    if (this.bytes.length < 100) {
      throw new Error('Buffer too small to be a valid SQLite database.');
    }
    const magicStr = String.fromCharCode(...this.bytes.subarray(0, 16));
    if (magicStr !== SQLITE_MAGIC) {
      throw new Error(`Invalid SQLite header: expected '${SQLITE_MAGIC}', got '${magicStr}'`);
    }

    // Page size at offset 16 (uint16 BE, 1 means 65536)
    const rawPageSize = this.view.getUint16(16, false);
    this.pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
    if (this.pageSize < 512 || (this.pageSize & (this.pageSize - 1)) !== 0) {
      throw new Error(`Invalid SQLite page size: ${this.pageSize}`);
    }

    this.tables = new Map();
    this._readMasterTable();
  }

  /**
   * Reads a single database page.
   * @param {number} pageNum 1-indexed page number
   * @returns {Uint8Array}
   */
  getPage(pageNum) {
    if (pageNum < 1) {
      throw new RangeError(`Invalid page number: ${pageNum}`);
    }
    const start = (pageNum - 1) * this.pageSize;
    const end = start + this.pageSize;
    if (start >= this.bytes.length) {
      throw new RangeError(`Page ${pageNum} offset ${start} exceeds database size ${this.bytes.length}`);
    }
    return this.bytes.subarray(start, Math.min(end, this.bytes.length));
  }

  /**
   * Parses sqlite_master on Root Page 1 to discover tables and root page numbers.
   * @private
   */
  _readMasterTable() {
    const records = this.readTableRows(1);
    for (const record of records) {
      // sqlite_master columns: type (0), name (1), tbl_name (2), rootpage (3), sql (4)
      if (record.length >= 4 && record[0] === 'table') {
        const name = record[1];
        const rootPage = record[3];
        this.tables.set(name, rootPage);
      }
    }
  }

  /**
   * Traverses a Table B-Tree starting at rootPage and returns all row records.
   * @param {number} rootPage 
   * @returns {any[][]}
   */
  readTableRows(rootPage) {
    const rows = [];
    const visitedPages = new Set();

    const traverse = (pageNum) => {
      if (visitedPages.has(pageNum)) return; // Guard circular loops
      visitedPages.add(pageNum);

      const pageBytes = this.getPage(pageNum);
      const isPage1 = pageNum === 1;
      const btreeHeaderOffset = isPage1 ? 100 : 0;
      if (pageBytes.length < btreeHeaderOffset + 8) return;

      const pageType = pageBytes[btreeHeaderOffset];
      const view = new DataView(pageBytes.buffer, pageBytes.byteOffset, pageBytes.byteLength);
      const numCells = view.getUint16(btreeHeaderOffset + 3, false);

      if (pageType === 0x0d) { // Table B-Tree Leaf Page
        const cellPointersOffset = btreeHeaderOffset + 8;
        for (let i = 0; i < numCells; i++) {
          if (cellPointersOffset + i * 2 + 2 > pageBytes.length) break;
          const cellOffset = view.getUint16(cellPointersOffset + i * 2, false);
          if (cellOffset < pageBytes.length) {
            const row = this._parseLeafCell(pageBytes, cellOffset);
            if (row) rows.push(row);
          }
        }
      } else if (pageType === 0x05) { // Table B-Tree Interior Page
        const rightChild = view.getUint32(btreeHeaderOffset + 8, false);
        const cellPointersOffset = btreeHeaderOffset + 12;
        for (let i = 0; i < numCells; i++) {
          if (cellPointersOffset + i * 2 + 2 > pageBytes.length) break;
          const cellOffset = view.getUint16(cellPointersOffset + i * 2, false);
          if (cellOffset + 4 <= pageBytes.length) {
            const leftChild = view.getUint32(cellOffset, false);
            traverse(leftChild);
          }
        }
        if (rightChild > 0) traverse(rightChild);
      }
    };

    traverse(rootPage);
    return rows;
  }

  /**
   * Parses a Table B-Tree leaf cell into a row array.
   * @private
   */
  _parseLeafCell(pageBytes, cellOffset) {
    let pos = cellOffset;
    const { value: payloadSize, bytesRead: read1 } = readVarint(pageBytes, pos);
    pos += read1;
    const { value: rowId, bytesRead: read2 } = readVarint(pageBytes, pos);
    pos += read2;

    if (pos >= pageBytes.length) return null;

    // Record payload
    const payloadStart = pos;
    const { value: headerSize, bytesRead: read3 } = readVarint(pageBytes, pos);
    pos += read3;

    const serialTypes = [];
    const headerEnd = payloadStart + headerSize;

    while (pos < headerEnd && pos < pageBytes.length) {
      const { value: serialType, bytesRead } = readVarint(pageBytes, pos);
      serialTypes.push(serialType);
      pos += bytesRead;
    }

    pos = headerEnd; // Body start
    const values = [];
    const view = new DataView(pageBytes.buffer, pageBytes.byteOffset, pageBytes.byteLength);

    for (const st of serialTypes) {
      if (st === 0) {
        values.push(null);
      } else if (st === 1) { // 8-bit int
        values.push((pageBytes[pos++] << 24) >> 24);
      } else if (st === 2) { // 16-bit int
        values.push(view.getInt16(pos, false));
        pos += 2;
      } else if (st === 3) { // 24-bit int
        const v = (pageBytes[pos] << 16) | (pageBytes[pos + 1] << 8) | pageBytes[pos + 2];
        values.push((v << 8) >> 8);
        pos += 3;
      } else if (st === 4) { // 32-bit int
        values.push(view.getInt32(pos, false));
        pos += 4;
      } else if (st === 5) { // 48-bit int
        const hi = view.getInt16(pos, false);
        const lo = view.getUint32(pos + 2, false);
        values.push(hi * 4294967296 + lo);
        pos += 6;
      } else if (st === 6) { // 64-bit int
        values.push(Number(view.getBigInt64(pos, false)));
        pos += 8;
      } else if (st === 7) { // 64-bit float
        values.push(view.getFloat64(pos, false));
        pos += 8;
      } else if (st === 8) {
        values.push(0);
      } else if (st === 9) {
        values.push(1);
      } else if (st >= 12 && st % 2 === 0) { // BLOB
        const len = (st - 12) / 2;
        values.push(pageBytes.subarray(pos, pos + len));
        pos += len;
      } else if (st >= 13 && st % 2 === 1) { // TEXT
        const len = (st - 13) / 2;
        const textBytes = pageBytes.subarray(pos, pos + len);
        values.push(Buffer.from(textBytes).toString('utf8'));
        pos += len;
      } else {
        values.push(null);
      }
    }

    return values;
  }
}
