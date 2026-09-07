/**
 * @file http_seekable.js
 * @description Cloud S3 and HTTP Range Request SeekableSource for Poltergeist.
 * Enables zero-download streaming ingestion of remote multi-gigabyte PDFs
 * hosted on AWS S3, Google Cloud Storage, Cloudflare R2, or HTTP servers.
 */

import { SeekableSource } from './seekable.js';

export class HttpSeekableSource extends SeekableSource {
  /**
   * @param {string} url Remote HTTP/HTTPS URL
   * @param {object} [options]
   * @param {number} options.size Total content length in bytes (if known)
   * @param {object} [options.headers={}] Custom HTTP headers (Authorization, S3 tokens, etc.)
   * @param {number} [options.chunkSize=1048576] Cache block size in bytes (default: 1 MB)
   */
  constructor(url, options = {}) {
    super();
    this.url = url;
    this.headers = options.headers || {};
    this.chunkSize = options.chunkSize || (1024 * 1024);
    this._size = options.size || -1;
    this.cache = new Map(); // Map<chunkIndex, Uint8Array>
    this.maxCachedChunks = options.maxCachedChunks || 32; // ~32 MB memory ceiling
  }

  get size() {
    if (this._size < 0) {
      throw new Error('HttpSeekableSource size unknown. Call await source.init() or HttpSeekableSource.open(url) first.');
    }
    return this._size;
  }

  /**
   * Factory method to probe remote URL, verify byte-range support, and prefetch headers.
   * @param {string} url
   * @param {object} [options]
   * @returns {Promise<HttpSeekableSource>}
   */
  static async open(url, options = {}) {
    const source = new HttpSeekableSource(url, options);
    await source.init();
    return source;
  }

  /**
   * Probes remote server via Range request to determine content size and verify Range support.
   */
  async init() {
    // 1. Probe first 1024 bytes (also checks %PDF- magic and gets Content-Range)
    const probeRes = await fetch(this.url, {
      headers: {
        ...this.headers,
        'Range': 'bytes=0-1023'
      }
    });

    if (probeRes.status === 206) {
      // Server supports byte ranges!
      const contentRange = probeRes.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/\/(\d+|\*)$/);
        if (match && match[1] !== '*') {
          this._size = parseInt(match[1], 10);
        }
      }
      const data = new Uint8Array(await probeRes.arrayBuffer());
      this._storeInCache(0, data);
    } else if (probeRes.status === 200) {
      // Server returned full file (does not support Range requests or file is small)
      const data = new Uint8Array(await probeRes.arrayBuffer());
      this._size = data.length;
      this._storeInCache(0, data);
      return;
    } else {
      throw new Error(`HTTP probe failed with status ${probeRes.status}: ${probeRes.statusText}`);
    }

    if (this._size < 0) {
      const len = probeRes.headers.get('content-length');
      if (len) {
        this._size = parseInt(len, 10);
      } else {
        throw new Error('Failed to determine remote file size from HTTP headers.');
      }
    }

    // 2. Prefetch the last 4096 bytes (contains startxref and trailer)
    if (this._size > 1024) {
      const suffixStart = Math.max(0, this._size - 4096);
      await this.prefetch(suffixStart, this._size - suffixStart);
    }
  }

  /**
   * Asynchronously reads bytes from the specified offset using HTTP Range requests.
   * @param {number} offset
   * @param {number} length
   * @returns {Promise<Uint8Array>}
   */
  async read(offset, length) {
    if (offset < 0 || offset > this._size) {
      throw new RangeError(`Offset ${offset} out of bounds (0..${this._size})`);
    }

    const actualLength = Math.max(0, Math.min(length, this._size - offset));
    if (actualLength === 0) {
      return new Uint8Array(0);
    }

    // Check if fully satisfied by cache
    const cached = this._readFromCache(offset, actualLength);
    if (cached) {
      return cached;
    }

    // Fetch required range
    const end = offset + actualLength - 1;
    const res = await fetch(this.url, {
      headers: {
        ...this.headers,
        'Range': `bytes=${offset}-${end}`
      }
    });

    if (!res.ok && res.status !== 206) {
      throw new Error(`HTTP Range fetch failed (${res.status}): ${res.statusText}`);
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    this._storeInCache(offset, buf);
    return buf.subarray(0, actualLength);
  }

  /**
   * Prefetches a byte range into the local memory cache.
   * @param {number} offset
   * @param {number} length
   */
  async prefetch(offset, length) {
    await this.read(offset, length);
  }

  /**
   * Synchronously reads bytes from cache. Throws RangeError if range not prefetched.
   * @param {number} offset
   * @param {number} length
   * @returns {Uint8Array}
   */
  readSync(offset, length) {
    if (offset < 0 || offset > this._size) {
      throw new RangeError(`Offset ${offset} out of bounds (0..${this._size})`);
    }
    const actualLength = Math.max(0, Math.min(length, this._size - offset));
    if (actualLength === 0) return new Uint8Array(0);

    const cached = this._readFromCache(offset, actualLength);
    if (cached) {
      return cached;
    }

    throw new Error(
      `HTTP range [${offset}..${offset + actualLength}] not in local cache. ` +
      `Ensure required ranges are prefetched via await source.prefetch() before synchronous consumption.`
    );
  }

  _storeInCache(offset, buffer) {
    // Keep cache bounded to maxCachedChunks using LRU eviction
    if (this.cache.size >= this.maxCachedChunks) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(offset, buffer);
  }

  _readFromCache(offset, length) {
    for (const [chunkOffset, chunkBuf] of this.cache.entries()) {
      if (offset >= chunkOffset && (offset + length) <= (chunkOffset + chunkBuf.length)) {
        const rel = offset - chunkOffset;
        return chunkBuf.subarray(rel, rel + length);
      }
    }
    return null;
  }

  close() {
    this.cache.clear();
  }
}
