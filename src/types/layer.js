/**
 * @file layer.js
 * @description Layered graphic data models, blend mode definitions, and layer hierarchy for Poltergeist.
 * Strictly zero-dependency and memory-safe.
 */

import { RasterImage, ColorSpaceType, PixelFormat } from './image.js';

/**
 * Standard prepress blend modes.
 * @readonly
 * @enum {string}
 */
export const BlendMode = Object.freeze({
  NORMAL: 'normal',
  MULTIPLY: 'multiply',
  SCREEN: 'screen',
  OVERLAY: 'overlay',
  DARKEN: 'darken',
  LIGHTEN: 'lighten',
  COLOR_DODGE: 'color_dodge',
  COLOR_BURN: 'color_burn',
  HARD_LIGHT: 'hard_light',
  SOFT_LIGHT: 'soft_light',
  DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion'
});

/**
 * Single layer record in a multi-layer spread.
 */
export class LayerRecord {
  /**
   * @param {object} options
   * @param {string} [options.name='Layer']
   * @param {number} [options.top=0]
   * @param {number} [options.left=0]
   * @param {number} [options.bottom=0]
   * @param {number} [options.right=0]
   * @param {number} [options.opacity=1.0] 0.0 to 1.0
   * @param {string} [options.blendMode=BlendMode.NORMAL]
   * @param {boolean} [options.visible=true]
   * @param {boolean} [options.clipping=false]
   * @param {boolean} [options.isFolder=false]
   * @param {number|null} [options.parentId=null]
   * @param {RasterImage|null} [options.image=null]
   * @param {Uint8Array|null} [options.mask=null]
   */
  constructor({
    name = 'Layer',
    top = 0,
    left = 0,
    bottom = 0,
    right = 0,
    width = 0,
    height = 0,
    opacity = 1.0,
    blendMode = BlendMode.NORMAL,
    visible = true,
    clipping = false,
    isFolder = false,
    parentId = null,
    image = null,
    mask = null
  } = {}) {
    let r = right;
    let b = bottom;
    if (r === 0 && width > 0) {
      r = left + width;
    }
    if (b === 0 && height > 0) {
      b = top + height;
    }

    this.name = name;
    this.top = top;
    this.left = left;
    this.bottom = b;
    this.right = r;
    this.width = Math.max(0, r - left);
    this.height = Math.max(0, b - top);
    this.opacity = Math.max(0.0, Math.min(1.0, opacity));
    this.blendMode = blendMode;
    this.visible = Boolean(visible);
    this.clipping = Boolean(clipping);
    this.isFolder = Boolean(isFolder);
    this.parentId = parentId;
    this.image = image;
    this.mask = mask;

    Object.freeze(this);
  }
}

/**
 * Layered image spread containing multiple layers, hierarchy, and composite proof.
 */
export class LayeredImage {
  /**
   * @param {object} options
   * @param {number} options.width
   * @param {number} options.height
   * @param {number} [options.dpiX=300]
   * @param {number} [options.dpiY=300]
   * @param {string} [options.colorSpace=ColorSpaceType.RGB]
   * @param {LayerRecord[]} [options.layers=[]]
   * @param {RasterImage|null} [options.composite=null]
   * @param {import('../color/icc/profile.js').IccProfile|null} [options.iccProfile=null]
   */
  constructor({
    width,
    height,
    dpiX = 300,
    dpiY = 300,
    colorSpace = ColorSpaceType.RGB,
    layers = [],
    composite = null,
    iccProfile = null
  }) {
    if (!Number.isInteger(width) || width <= 0) {
      throw new RangeError(`Invalid canvas width: ${width}`);
    }
    if (!Number.isInteger(height) || height <= 0) {
      throw new RangeError(`Invalid canvas height: ${height}`);
    }

    this.width = width;
    this.height = height;
    this.dpiX = dpiX > 0 ? dpiX : 300;
    this.dpiY = dpiY > 0 ? dpiY : 300;
    this.colorSpace = colorSpace;
    this.layers = Object.freeze([...layers]);
    this.composite = composite;
    this.iccProfile = iccProfile;

    Object.freeze(this);
  }

  get resolution() {
    return { dpiX: this.dpiX, dpiY: this.dpiY };
  }
}
