/**
 * @file seekable.js
 * @description Abstract SeekableSource interface and BufferSeekableSource implementation for Poltergeist.
 * Enables zero-dependency random-access reading over in-memory buffers, local file handles, and HTTP streams.
 */

/**
 * Abstract interface for random-access byte sources.
 */
export class SeekableSource {
  /**
   * Total size of the source in bytes.
   * @type {number}
   */
  get size() {
    throw new Error('size getter not implemented');
  }

  /**
   * Asynchronously reads bytes from the specified offset.
   * @param {number} offset Start byte offset
   * @param {number} length Number of bytes to read
   * @returns {Promise<Uint8Array>}
   */
  async read(offset, length) {
    throw new Error('read() not implemented');
  }

  /**
   * Synchronously reads bytes from the specified offset.
   * @param {number} offset Start byte offset
   * @param {number} length Number of bytes to read
   * @returns {Uint8Array}
   */
  readSync(offset, length) {
    throw new Error('readSync() not implemented');
  }

  /**
   * Creates a sub-source windowed to [offset, offset + length].
   * @param {number} offset
   * @param {number} length
   * @returns {SeekableSource}
   */
  slice(offset, length) {
    throw new Error('slice() not implemented');
  }

  /**
   * Closes the source and releases any underlying descriptors or handles.
   * @returns {Promise<void>|void}
   */
  close() {}
}

/**
 * In-memory SeekableSource wrapping a Uint8Array or Buffer.
 * Preserves 100% backward compatibility for existing in-memory workflows.
 */
export class BufferSeekableSource extends SeekableSource {
  /**
   * @param {Uint8Array|Buffer} buffer
   */
  constructor(buffer) {
    super();
    this.buffer = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  get size() {
    return this.buffer.length;
  }

  async read(offset, length) {
    return this.readSync(offset, length);
  }

  readSync(offset, length) {
    if (offset < 0 || offset > this.buffer.length) {
      throw new RangeError(`Offset ${offset} out of bounds (0..${this.buffer.length})`);
    }
    const end = Math.min(this.buffer.length, offset + Math.max(0, length));
    return this.buffer.subarray(offset, end);
  }

  slice(offset, length) {
    const sub = this.readSync(offset, length);
    return new BufferSeekableSource(sub);
  }

  close() {
    // In-memory buffer needs no descriptor closing
  }
}

/**
 * Wraps a SeekableSource in a sliding-window typed array proxy,
 * enabling index-based access (bytes[i]) and subarray(start, end)
 * across 5 GB+ files without loading them entirely into memory.
 * 
 * @param {Uint8Array|Buffer|SeekableSource} source
 * @returns {Uint8Array}
 */
export function createSeekableBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof BufferSeekableSource) return source.buffer;
  if (!(source instanceof SeekableSource)) {
    return new Uint8Array(source);
  }

  class WindowedProxy {
    constructor(src) {
      this.src = src;
      this.length = src.size;
      this.byteLength = src.size;
      this.wOffset = -1;
      this.wBuf = null;
      this.wSize = 131072; // 128 KB sliding window
      return new Proxy(this, {
        get(target, prop) {
          if (typeof prop === 'symbol') {
            return target[prop];
          }
          if (prop === 'length' || prop === 'byteLength') return target.length;
          if (prop === 'subarray' || prop === 'slice') {
            return (s, e) => target.src.readSync(s, (e !== undefined ? e : target.length) - s);
          }
          const idx = Number(prop);
          if (!Number.isNaN(idx)) {
            return target.getByte(idx);
          }
          return target[prop];
        }
      });
    }

    getByte(pos) {
      if (!this.wBuf || pos < this.wOffset || pos >= this.wOffset + this.wBuf.length) {
        this.wOffset = pos;
        this.wBuf = this.src.readSync(pos, Math.min(this.wSize, this.length - pos));
      }
      return this.wBuf[pos - this.wOffset];
    }
  }

  return new WindowedProxy(source);
}

