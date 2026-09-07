/**
 * @file zip_reader.js
 * @description Pure native, memory-safe ZIP archive reader for Poltergeist.
 * Zero-dependency, parses Central Directory headers and decompresses Stored and Deflate entries.
 * Includes strict Zip-Slip path traversal security guards.
 */

import zlib from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

export class ZipEntry {
  /**
   * @param {object} params
   * @param {string} params.name
   * @param {number} params.compressionMethod 0 = Stored, 8 = Deflated
   * @param {number} params.compressedSize
   * @param {number} params.uncompressedSize
   * @param {number} params.localHeaderOffset
   */
  constructor({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset }) {
    this.name = name;
    this.compressionMethod = compressionMethod;
    this.compressedSize = compressedSize;
    this.uncompressedSize = uncompressedSize;
    this.localHeaderOffset = localHeaderOffset;
    this.isDirectory = name.endsWith('/');
  }
}

export class ZipReader {
  /**
   * Sniffs whether buffer has a ZIP signature (PK\x03\x04 or PK\x05\x06).
   * @param {Uint8Array} buffer
   * @returns {boolean}
   */
  static probe(buffer) {
    if (!buffer || buffer.length < 4) return false;
    return buffer[0] === 0x50 && buffer[1] === 0x4B &&
      ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
       (buffer[2] === 0x05 && buffer[3] === 0x06) ||
       (buffer[2] === 0x07 && buffer[3] === 0x08));
  }

  /**
   * @param {Uint8Array|Buffer} buffer
   */
  constructor(buffer) {
    this.bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.entries = new Map();

    if (this.bytes.length < 22) {
      throw new Error('Buffer too small to be a valid ZIP archive.');
    }

    this._findAndParseCentralDirectory();
  }

  /**
   * Locates the End of Central Directory (EOCD) record by searching backward from EOF.
   * @private
   */
  _findAndParseCentralDirectory() {
    const len = this.bytes.length;
    let eocdOffset = -1;

    // Search up to 65KB from EOF for EOCD signature
    const maxSearch = Math.min(len - 22, 65557);
    for (let i = 0; i <= maxSearch; i++) {
      const pos = len - 22 - i;
      if (this.view.getUint32(pos, true) === EOCD_SIGNATURE) {
        eocdOffset = pos;
        break;
      }
    }

    if (eocdOffset === -1) {
      throw new Error('Invalid ZIP archive: End of Central Directory (EOCD) not found.');
    }

    const totalEntries = this.view.getUint16(eocdOffset + 10, true);
    const centralDirSize = this.view.getUint32(eocdOffset + 12, true);
    const centralDirOffset = this.view.getUint32(eocdOffset + 16, true);

    if (centralDirOffset + centralDirSize > len) {
      throw new RangeError('Central directory offset exceeds ZIP buffer bounds.');
    }

    // Traverse Central Directory headers
    let pos = centralDirOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (pos + 46 > len) break;

      const sig = this.view.getUint32(pos, true);
      if (sig !== CENTRAL_DIR_SIGNATURE) {
        break;
      }

      const method = this.view.getUint16(pos + 10, true);
      const compSize = this.view.getUint32(pos + 20, true);
      const uncompSize = this.view.getUint32(pos + 24, true);
      const nameLen = this.view.getUint16(pos + 28, true);
      const extraLen = this.view.getUint16(pos + 30, true);
      const commentLen = this.view.getUint16(pos + 32, true);
      const localOffset = this.view.getUint32(pos + 42, true);

      const nameBytes = this.bytes.subarray(pos + 46, pos + 46 + nameLen);
      const name = new TextDecoder('utf8').decode(nameBytes);

      // Security: Zip-Slip prevention
      if (name.includes('..') || name.startsWith('/') || name.startsWith('\\')) {
        throw new Error(`Security Violation: Disallowed path traversal in ZIP entry: ${name}`);
      }

      this.entries.set(name, new ZipEntry({
        name,
        compressionMethod: method,
        compressedSize: compSize,
        uncompressedSize: uncompSize,
        localHeaderOffset: localOffset
      }));

      pos += 46 + nameLen + extraLen + commentLen;
    }
  }

  /**
   * Checks if an entry exists in the archive.
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this.entries.has(name);
  }

  hasFile(name) {
    return this.has(name);
  }

  /**
   * Returns list of all entry names.
   * @returns {string[]}
   */
  getFileNames() {
    return Array.from(this.entries.keys());
  }

  listFiles() {
    return this.getFileNames();
  }

  /**
   * Decompresses and extracts the byte content of an entry.
   * @param {string} name
   * @returns {Uint8Array}
   */
  read(name) {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new Error(`Entry not found in ZIP archive: ${name}`);
    }

    if (entry.isDirectory) {
      return new Uint8Array(0);
    }

    // Memory safety: Allocation threshold guard (Rule 6)
    if (entry.uncompressedSize > 536870912) { // 512 MB
      throw new RangeError(`ZIP entry '${name}' uncompressed size (${entry.uncompressedSize}) exceeds 512MB threshold.`);
    }

    const localOffset = entry.localHeaderOffset;
    if (localOffset + 30 > this.bytes.length) {
      throw new RangeError(`Local header for '${name}' exceeds buffer bounds.`);
    }

    const sig = this.view.getUint32(localOffset, true);
    if (sig !== LOCAL_HEADER_SIGNATURE) {
      throw new Error(`Invalid local file header signature for '${name}'.`);
    }

    const nameLen = this.view.getUint16(localOffset + 26, true);
    const extraLen = this.view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + nameLen + extraLen;

    if (dataStart + entry.compressedSize > this.bytes.length) {
      throw new RangeError(`Data stream for '${name}' exceeds buffer bounds.`);
    }

    const compressedBytes = this.bytes.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.compressionMethod === 0) {
      // Stored (uncompressed)
      return compressedBytes.slice(0, entry.uncompressedSize);
    } else if (entry.compressionMethod === 8) {
      // Deflate
      const decompressed = zlib.inflateRawSync(compressedBytes);
      return new Uint8Array(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);
    } else {
      throw new Error(`Unsupported ZIP compression method (${entry.compressionMethod}) for entry: ${name}`);
    }
  }

  readFile(name) {
    return this.read(name);
  }

  /**
   * Reads entry content as UTF-8 string.
   * @param {string} name
   * @returns {string}
   */
  readText(name) {
    const bytes = this.read(name);
    return new TextDecoder('utf8').decode(bytes);
  }
}
