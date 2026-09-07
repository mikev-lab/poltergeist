/**
 * @file image.js
 * @description Core image data models, pixel formats, and metadata for Poltergeist.
 * Strictly zero-dependency and memory-safe.
 */

/**
 * Pixel format channel encodings.
 * @readonly
 * @enum {string}
 */
export const PixelFormat = Object.freeze({
  GRAY8: 'GRAY8',
  GRAY16: 'GRAY16',
  RGB24: 'RGB24',
  RGBA32: 'RGBA32',
  RGB48: 'RGB48',
  RGBA64: 'RGBA64',
  CMYK32: 'CMYK32',
  CMYK64: 'CMYK64',
  DEVICE_N: 'DEVICE_N'
});

/**
 * Color space types.
 * @readonly
 * @enum {string}
 */
export const ColorSpaceType = Object.freeze({
  GRAY: 'GRAY',
  RGB: 'RGB',
  CMYK: 'CMYK',
  INDEXED: 'INDEXED',
  DEVICE_N: 'DEVICE_N'
});

/**
 * Maximum safe allocation threshold (2 GB per single raster buffer).
 */
export const MAX_SAFE_BUFFER_SIZE = 2 * 1024 * 1024 * 1024;

/**
 * Maximum dimension allowed to guard against integer overflow.
 */
export const MAX_DIMENSION = 65535;

/**
 * Validates raster dimensions and computes buffer length with overflow guards.
 * @param {number} width 
 * @param {number} height 
 * @param {number} channels 
 * @param {number} bytesPerSample 
 * @returns {number} Required buffer size in bytes
 */
export function calculateBufferSize(width, height, channels, bytesPerSample) {
  if (!Number.isInteger(width) || width <= 0 || width > MAX_DIMENSION) {
    throw new RangeError(`Invalid image width: ${width}. Must be integer in 1..${MAX_DIMENSION}`);
  }
  if (!Number.isInteger(height) || height <= 0 || height > MAX_DIMENSION) {
    throw new RangeError(`Invalid image height: ${height}. Must be integer in 1..${MAX_DIMENSION}`);
  }
  if (!Number.isInteger(channels) || channels <= 0 || channels > 32) {
    throw new RangeError(`Invalid channel count: ${channels}. Must be integer in 1..32`);
  }
  if (bytesPerSample !== 1 && bytesPerSample !== 2 && bytesPerSample !== 4) {
    throw new RangeError(`Invalid bytesPerSample: ${bytesPerSample}. Must be 1, 2, or 4`);
  }

  const numPixels = width * height;
  const totalBytes = numPixels * channels * bytesPerSample;

  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_SAFE_BUFFER_SIZE) {
    throw new RangeError(`Allocation of ${totalBytes} bytes exceeds maximum safe buffer size (${MAX_SAFE_BUFFER_SIZE} bytes).`);
  }

  return totalBytes;
}

/**
 * Immutable in-memory raster image container.
 */
export class RasterImage {
  /**
   * @param {object} options
   * @param {number} options.width
   * @param {number} options.height
   * @param {number} [options.channels=3]
   * @param {number} [options.bitsPerSample=8]
   * @param {string} [options.colorSpace=ColorSpaceType.RGB]
   * @param {string} [options.pixelFormat=PixelFormat.RGB24]
   * @param {number} [options.dpiX=300]
   * @param {number} [options.dpiY=300]
   * @param {Uint8Array} [options.data]
   * @param {import('../color/icc/profile.js').IccProfile|null} [options.iccProfile=null]
   * @param {string[]} [options.spotNames=[]]
   * @param {Uint8Array|null} [options.palette=null]
   * @param {boolean} [options.hasAlpha=false]
   */
  constructor({
    width,
    height,
    channels = 3,
    bitsPerSample = 8,
    colorSpace = ColorSpaceType.RGB,
    pixelFormat = PixelFormat.RGB24,
    dpiX = 300,
    dpiY = 300,
    data,
    iccProfile = null,
    spotNames = [],
    palette = null,
    hasAlpha = false
  }) {
    const bytesPerSample = bitsPerSample === 16 ? 2 : bitsPerSample === 32 ? 4 : 1;
    const requiredSize = calculateBufferSize(width, height, channels, bytesPerSample);

    if (data) {
      if (!(data instanceof Uint8Array)) {
        throw new TypeError('Image data must be an instance of Uint8Array');
      }
      if (data.byteLength < requiredSize) {
        throw new RangeError(`Provided buffer size (${data.byteLength} bytes) is smaller than required (${requiredSize} bytes)`);
      }
      this.data = data.byteLength === requiredSize ? data : data.subarray(0, requiredSize);
    } else {
      this.data = new Uint8Array(requiredSize);
    }

    this.width = width;
    this.height = height;
    this.channels = channels;
    this.bitsPerSample = bitsPerSample;
    this.bytesPerSample = bytesPerSample;
    this.colorSpace = colorSpace;
    this.pixelFormat = pixelFormat;
    this.dpiX = dpiX > 0 ? dpiX : 300;
    this.dpiY = dpiY > 0 ? dpiY : 300;
    this.iccProfile = iccProfile;
    this.spotNames = Object.freeze([...spotNames]);
    this.palette = palette ? new Uint8Array(palette) : null;
    this.hasAlpha = Boolean(hasAlpha);

    Object.freeze(this);
  }

  /**
   * Stride in bytes per scanline.
   * @type {number}
   */
  get rowStride() {
    return this.width * this.channels * this.bytesPerSample;
  }

  /**
   * Total pixel count.
   * @type {number}
   */
  get pixelCount() {
    return this.width * this.height;
  }

  /**
   * Creates a sub-view of a specific scanline row without memory copying.
   * @param {number} y 0-indexed row
   * @returns {Uint8Array}
   */
  getScanline(y) {
    if (y < 0 || y >= this.height) {
      throw new RangeError(`Scanline index ${y} out of range (height: ${this.height})`);
    }
    const offset = y * this.rowStride;
    return this.data.subarray(offset, offset + this.rowStride);
  }
}
