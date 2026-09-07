/**
 * @file file_seekable.js
 * @description Random-access SeekableSource over local filesystem files with sliding-window cache.
 * Enables zero-dependency streaming of 5 GB, 20 GB, and 100 GB files within < 50 MB RAM.
 */

import fs from 'node:fs';
import { SeekableSource } from './seekable.js';

export class FileSeekableSource extends SeekableSource {
  /**
   * @param {string|number} target File path or file descriptor
   * @param {object} [options]
   * @param {number} [options.windowSize=1048576] Cache window size in bytes (default: 1 MB)
   */
  constructor(target, options = {}) {
    super();
    this.windowSize = options.windowSize || (1024 * 1024); // 1 MB window
    this.openedHere = false;

    if (typeof target === 'string') {
      this.filePath = target;
      this.fd = fs.openSync(target, 'r');
      this.openedHere = true;
    } else if (typeof target === 'number') {
      this.fd = target;
    } else {
      throw new TypeError(`Expected file path string or numeric file descriptor. Got: ${typeof target}`);
    }

    const stat = fs.fstatSync(this.fd);
    this._size = stat.size;

    // Sliding window cache
    this.cacheOffset = -1;
    this.cacheBuffer = null;
  }

  get size() {
    return this._size;
  }

  /**
   * Synchronously reads bytes from the file using the sliding-window cache.
   * @param {number} offset
   * @param {number} length
   * @returns {Uint8Array}
   */
  readSync(offset, length) {
    if (offset < 0 || offset > this._size) {
      throw new RangeError(`Offset ${offset} out of bounds (0..${this._size})`);
    }

    const actualLength = Math.max(0, Math.min(length, this._size - offset));
    if (actualLength === 0) {
      return new Uint8Array(0);
    }

    // 1. If request is larger than windowSize, read directly without caching
    if (actualLength > this.windowSize) {
      const buf = Buffer.allocUnsafe(actualLength);
      const bytesRead = fs.readSync(this.fd, buf, 0, actualLength, offset);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    }

    // 2. Check if request hits current sliding-window cache
    if (
      this.cacheBuffer &&
      offset >= this.cacheOffset &&
      (offset + actualLength) <= (this.cacheOffset + this.cacheBuffer.length)
    ) {
      const relOffset = offset - this.cacheOffset;
      return this.cacheBuffer.subarray(relOffset, relOffset + actualLength);
    }

    // 3. Cache miss: fill new sliding window starting at offset
    const toRead = Math.min(this.windowSize, this._size - offset);
    const windowBuf = Buffer.allocUnsafe(toRead);
    const bytesRead = fs.readSync(this.fd, windowBuf, 0, toRead, offset);

    this.cacheOffset = offset;
    this.cacheBuffer = new Uint8Array(windowBuf.buffer, windowBuf.byteOffset, bytesRead);

    return this.cacheBuffer.subarray(0, actualLength);
  }

  async read(offset, length) {
    return this.readSync(offset, length);
  }

  slice(offset, length) {
    // Windowed sub-source sharing the same underlying file descriptor
    return new WindowedFileSeekableSource(this, offset, length);
  }

  close() {
    if (this.openedHere && this.fd !== undefined) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // Ignored if already closed
      }
      this.fd = undefined;
    }
    this.cacheBuffer = null;
  }
}

/**
 * Windowed slice view over a parent FileSeekableSource.
 */
class WindowedFileSeekableSource extends SeekableSource {
  constructor(parent, sliceOffset, sliceLength) {
    super();
    this.parent = parent;
    this.sliceOffset = Math.max(0, Math.min(sliceOffset, parent.size));
    this._size = Math.max(0, Math.min(sliceLength, parent.size - this.sliceOffset));
  }

  get size() {
    return this._size;
  }

  readSync(offset, length) {
    if (offset < 0 || offset > this._size) {
      throw new RangeError(`Slice offset ${offset} out of bounds (0..${this._size})`);
    }
    const actualLength = Math.min(length, this._size - offset);
    return this.parent.readSync(this.sliceOffset + offset, actualLength);
  }

  async read(offset, length) {
    return this.readSync(offset, length);
  }

  slice(offset, length) {
    return new WindowedFileSeekableSource(this.parent, this.sliceOffset + offset, length);
  }

  close() {
    // Parent manages fd lifecycle
  }
}
