/**
 * @file xcf_decoder.js
 * @description Pure native GIMP XCF format decoder for Poltergeist.
 * Strictly zero-dependency and memory-safe.
 */

import { LayeredImage, LayerRecord, BlendMode } from '../../../types/layer.js';
import { ColorSpaceType } from '../../../types/image.js';

export class XcfDecoder {
  /**
   * Decodes a GIMP XCF binary buffer into a LayeredImage.
   * @param {Uint8Array|Buffer} buffer 
   * @returns {LayeredImage}
   */
  static decode(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length < 26) {
      throw new Error('Invalid XCF stream: buffer less than header size.');
    }

    const magic = String.fromCharCode(...bytes.subarray(0, 9));
    if (magic !== 'gimp xcf ') {
      throw new Error(`Invalid XCF magic signature: expected 'gimp xcf ', got '${magic}'`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(14, false);
    const height = view.getUint32(18, false);
    const baseType = view.getUint32(22, false); // 0=RGB, 1=GRAY, 2=INDEXED

    let dpiX = 300;
    let dpiY = 300;
    let offset = 26;

    // Read canvas properties until PROP_END (0)
    while (offset + 8 <= bytes.length) {
      const propType = view.getUint32(offset, false);
      const propLength = view.getUint32(offset + 4, false);
      offset += 8;

      if (propType === 0) break; // PROP_END

      if (propType === 18 && propLength >= 8) { // PROP_RESOLUTION
        const xRes = view.getFloat32(offset, false);
        const yRes = view.getFloat32(offset + 4, false);
        if (xRes > 0) dpiX = Math.round(xRes);
        if (yRes > 0) dpiY = Math.round(yRes);
      }

      offset += propLength;
    }

    // Read layer pointers (array of uint32 offsets ending with 0)
    const layerOffsets = [];
    while (offset + 4 <= bytes.length) {
      const ptr = view.getUint32(offset, false);
      offset += 4;
      if (ptr === 0) break;
      layerOffsets.push(ptr);
    }

    const layers = [];
    for (let i = 0; i < layerOffsets.length; i++) {
      const layerPtr = layerOffsets[i];
      if (layerPtr + 12 > bytes.length) continue;

      const lWidth = view.getUint32(layerPtr, false);
      const lHeight = view.getUint32(layerPtr + 4, false);
      const lType = view.getUint32(layerPtr + 8, false);

      let lPos = layerPtr + 12;
      // Layer name: uint32 length + chars
      let name = `Layer ${i + 1}`;
      if (lPos + 4 <= bytes.length) {
        const nameLen = view.getUint32(lPos, false);
        lPos += 4;
        if (nameLen > 0 && lPos + nameLen <= bytes.length) {
          name = String.fromCharCode(...bytes.subarray(lPos, lPos + nameLen - 1));
          lPos += nameLen;
        }
      }

      let opacity = 1.0;
      let visible = true;
      let offX = 0;
      let offY = 0;

      // Layer properties
      while (lPos + 8 <= bytes.length) {
        const pType = view.getUint32(lPos, false);
        const pLen = view.getUint32(lPos + 4, false);
        lPos += 8;
        if (pType === 0) break; // PROP_END

        if (pType === 6 && pLen >= 4) { // PROP_OPACITY
          opacity = view.getFloat32(lPos, false) / 255.0;
        } else if (pType === 7 && pLen >= 4) { // PROP_VISIBLE
          visible = view.getUint32(lPos, false) !== 0;
        } else if (pType === 15 && pLen >= 8) { // PROP_OFFSETS
          offX = view.getInt32(lPos, false);
          offY = view.getInt32(lPos + 4, false);
        }

        lPos += pLen;
      }

      layers.push(new LayerRecord({
        name,
        top: offY,
        left: offX,
        bottom: offY + lHeight,
        right: offX + lWidth,
        opacity: Math.max(0.0, Math.min(1.0, opacity)),
        blendMode: BlendMode.NORMAL,
        visible
      }));
    }

    return new LayeredImage({
      width,
      height,
      dpiX,
      dpiY,
      colorSpace: baseType === 1 ? ColorSpaceType.GRAY : ColorSpaceType.RGB,
      layers
    });
  }
}
