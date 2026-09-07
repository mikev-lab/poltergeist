/**
 * @file layer_mask.js
 * @description Layer & Mask Information section parser for Adobe PSD / PSB.
 * Extracts individual layer records, bounds, channels, blend modes, and pixel data.
 */

import zlib from 'node:zlib';
import { LayerRecord, BlendMode } from '../../../types/layer.js';
import { RasterImage, ColorSpaceType, PixelFormat } from '../../../types/image.js';
import { decompressPsdPackBits } from './rle.js';

// Map Photoshop 4-char blend keys to BlendMode enum
const PSD_BLEND_MODES = Object.freeze({
  'norm': BlendMode.NORMAL,
  'mul ': BlendMode.MULTIPLY,
  'scrn': BlendMode.SCREEN,
  'over': BlendMode.OVERLAY,
  'dark': BlendMode.DARKEN,
  'lite': BlendMode.LIGHTEN,
  'div ': BlendMode.COLOR_DODGE,
  'idiv': BlendMode.COLOR_BURN,
  'hLit': BlendMode.HARD_LIGHT,
  'sLit': BlendMode.SOFT_LIGHT,
  'diff': BlendMode.DIFFERENCE,
  'smud': BlendMode.EXCLUSION
});

export class PsdLayerMaskParser {
  /**
   * Parses the Layer and Mask Information section.
   * @param {Uint8Array} bytes 
   * @param {number} startOffset 
   * @param {boolean} isPsb 
   * @param {string} colorSpace 
   * @returns {LayerRecord[]}
   */
  static parse(bytes, startOffset, isPsb, colorSpace) {
    let offset = startOffset;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const sectionLength = isPsb
      ? Number(view.getBigUint64(offset, false))
      : view.getUint32(offset, false);
    offset += isPsb ? 8 : 4;

    if (sectionLength === 0 || offset + sectionLength > bytes.length) {
      return [];
    }

    const layerInfoLength = isPsb
      ? Number(view.getBigUint64(offset, false))
      : view.getUint32(offset, false);
    offset += isPsb ? 8 : 4;

    if (layerInfoLength === 0) {
      return [];
    }

    const layerCountRaw = view.getInt16(offset, false);
    offset += 2;
    const layerCount = Math.abs(layerCountRaw);
    if (layerCount === 0) return [];

    const layerDefs = [];

    // 1. Parse Layer Records
    for (let i = 0; i < layerCount; i++) {
      let top, left, bottom, right;
      if (isPsb) {
        top = Number(view.getBigInt64(offset, false));
        left = Number(view.getBigInt64(offset + 8, false));
        bottom = Number(view.getBigInt64(offset + 16, false));
        right = Number(view.getBigInt64(offset + 24, false));
        offset += 32;
      } else {
        top = view.getInt32(offset, false);
        left = view.getInt32(offset + 4, false);
        bottom = view.getInt32(offset + 8, false);
        right = view.getInt32(offset + 12, false);
        offset += 16;
      }

      const numChannels = view.getUint16(offset, false);
      offset += 2;

      const channelsInfo = [];
      for (let c = 0; c < numChannels; c++) {
        const channelId = view.getInt16(offset, false);
        const channelDataLen = isPsb
          ? Number(view.getBigUint64(offset + 2, false))
          : view.getUint32(offset + 2, false);
        offset += isPsb ? 10 : 6;
        channelsInfo.push({ channelId, channelDataLen });
      }

      // Blend mode signature: '8BIM'
      offset += 4;
      const blendKey = String.fromCharCode(
        bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]
      );
      offset += 4;
      const blendMode = PSD_BLEND_MODES[blendKey] || BlendMode.NORMAL;

      const opacity = bytes[offset++] / 255.0;
      const clipping = bytes[offset++] !== 0;
      const flags = bytes[offset++];
      const visible = (flags & 0x02) === 0; // bit 1: 0=visible, 1=hidden
      offset++; // filler

      // Extra data field length
      const extraLen = view.getUint32(offset, false);
      offset += 4;
      const extraEnd = offset + extraLen;

      // Skip layer mask / adjustment layer info
      let maskDataLen = 0;
      if (offset < extraEnd) {
        maskDataLen = view.getUint32(offset, false);
        offset += 4 + maskDataLen;
      }

      // Skip blending ranges
      if (offset < extraEnd) {
        const rangesLen = view.getUint32(offset, false);
        offset += 4 + rangesLen;
      }

      // Pascal string layer name
      let name = `Layer ${i + 1}`;
      if (offset < extraEnd) {
        const nameLen = bytes[offset++];
        if (nameLen > 0 && offset + nameLen <= extraEnd) {
          name = String.fromCharCode(...bytes.subarray(offset, offset + nameLen));
          offset += nameLen;
        }
      }

      offset = extraEnd; // Jump to end of extra data

      layerDefs.push({
        name,
        top,
        left,
        bottom,
        right,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
        opacity,
        blendMode,
        visible,
        clipping,
        channelsInfo
      });
    }

    // 2. Parse Channel Image Data for each layer
    const resultLayers = [];

    for (const def of layerDefs) {
      const { width, height } = def;
      if (width < 0 || height < 0 || width > 300000 || height > 300000 || (width * height > 536870912)) {
        throw new RangeError(`Layer '${def.name}' dimensions (${width}x${height}) exceed memory safety allocation threshold.`);
      }
      if (width === 0 || height === 0) {
        resultLayers.push(new LayerRecord({
          name: def.name,
          top: def.top,
          left: def.left,
          bottom: def.bottom,
          right: def.right,
          opacity: def.opacity,
          blendMode: def.blendMode,
          visible: def.visible,
          clipping: def.clipping
        }));
        continue;
      }

      const channelPlanes = new Map();

      for (const ch of def.channelsInfo) {
        if (offset + 2 > bytes.length) break;
        const compression = view.getUint16(offset, false);
        offset += 2;

        const planeData = new Uint8Array(width * height);

        if (compression === 0) { // Raw uncompressed
          const readLen = Math.min(planeData.length, bytes.length - offset);
          planeData.set(bytes.subarray(offset, offset + readLen));
          offset += ch.channelDataLen - 2;
        } else if (compression === 1) { // PackBits RLE
          const lineLengths = [];
          for (let y = 0; y < height; y++) {
            lineLengths.push(view.getUint16(offset, false));
            offset += 2;
          }

          let destPos = 0;
          for (let y = 0; y < height; y++) {
            const lineLen = lineLengths[y];
            decompressPsdPackBits(bytes, offset, lineLen, planeData, destPos, width);
            offset += lineLen;
            destPos += width;
          }
        } else if (compression === 2) { // ZIP without prediction
          try {
            const compPayload = bytes.subarray(offset, offset + ch.channelDataLen - 2);
            const decomp = zlib.inflateSync(compPayload);
            planeData.set(decomp.subarray(0, planeData.length));
          } catch {
            // non-fatal
          }
          offset += ch.channelDataLen - 2;
        }

        channelPlanes.set(ch.channelId, planeData);
      }

      // Assemble channel planes into RGBA32
      const pixelCount = width * height;
      const rgbaData = new Uint8Array(pixelCount * 4);
      const redPlane = channelPlanes.get(0) || new Uint8Array(pixelCount);
      const greenPlane = channelPlanes.get(1) || new Uint8Array(pixelCount);
      const bluePlane = channelPlanes.get(2) || new Uint8Array(pixelCount);
      const alphaPlane = channelPlanes.get(-1); // Alpha channel

      for (let p = 0; p < pixelCount; p++) {
        rgbaData[p * 4] = redPlane[p];
        rgbaData[p * 4 + 1] = greenPlane[p];
        rgbaData[p * 4 + 2] = bluePlane[p];
        rgbaData[p * 4 + 3] = alphaPlane ? alphaPlane[p] : 255;
      }

      const layerImage = new RasterImage({
        width,
        height,
        channels: 4,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.RGB,
        pixelFormat: PixelFormat.RGBA32,
        data: rgbaData,
        hasAlpha: true
      });

      resultLayers.push(new LayerRecord({
        name: def.name,
        top: def.top,
        left: def.left,
        bottom: def.bottom,
        right: def.right,
        opacity: def.opacity,
        blendMode: def.blendMode,
        visible: def.visible,
        clipping: def.clipping,
        image: layerImage
      }));
    }

    return resultLayers;
  }
}
