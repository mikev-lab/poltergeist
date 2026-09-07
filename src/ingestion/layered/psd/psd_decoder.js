/**
 * @file psd_decoder.js
 * @description Pure native Adobe Photoshop PSD and PSB decoder for Poltergeist.
 * Strictly zero-dependency, memory-safe, supports multi-layer spreads and PSB large format.
 */

import { PsdHeader } from './header.js';
import { PsdResources } from './resources.js';
import { PsdLayerMaskParser } from './layer_mask.js';
import { LayeredImage } from '../../../types/layer.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../../types/image.js';

export class PsdDecoder {
  /**
   * Decodes a PSD or PSB binary buffer into a LayeredImage.
   * @param {Uint8Array|Buffer} buffer 
   * @returns {LayeredImage}
   */
  static decode(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 1. Header (26 bytes)
    const header = PsdHeader.fromBuffer(bytes);
    let offset = 26;

    // 2. Color Mode Data Section
    if (offset + 4 > bytes.length) {
      throw new Error('PSD stream truncated at Color Mode Data section.');
    }
    const colorModeDataLength = view.getUint32(offset, false);
    offset += 4 + colorModeDataLength;

    // 3. Image Resources Section
    if (offset + 4 > bytes.length) {
      throw new Error('PSD stream truncated at Image Resources section.');
    }
    const imageResourcesLength = view.getUint32(offset, false);
    offset += 4;
    const resources = PsdResources.parse(bytes, offset, imageResourcesLength);
    offset += imageResourcesLength;

    // 4. Layer and Mask Information Section
    let layers = [];
    if (offset < bytes.length) {
      layers = PsdLayerMaskParser.parse(bytes, offset, header.isPsb, header.colorSpace);
    }

    return new LayeredImage({
      width: header.width,
      height: header.height,
      dpiX: resources.dpiX,
      dpiY: resources.dpiY,
      colorSpace: header.colorSpace,
      layers,
      iccProfile: resources.iccProfile
    });
  }
}
