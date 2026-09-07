/**
 * @file tiff_writer.js
 * @description Pure native TIFF 6.0 binary serializer for Poltergeist.
 * Zero-dependency, supports CMYK, RGB, Grayscale, Deflate compression, and ICC embedding.
 */

import zlib from 'node:zlib';
import { ColorSpaceType } from '../../types/image.js';

export class TiffWriter {
  /**
   * Serializes a RasterImage into a TIFF 6.0 binary buffer.
   * @param {import('../../types/image.js').RasterImage} image 
   * @param {object} [options]
   * @param {boolean} [options.compress=true] Use Deflate compression (Tag 8)
   * @returns {Uint8Array}
   */
  static write(image, options = {}) {
    const compress = options.compress !== false;
    const { width, height, channels, bitsPerSample, colorSpace, dpiX, dpiY } = image;

    let photometric = 2; // RGB
    if (colorSpace === ColorSpaceType.CMYK) {
      photometric = 5;
    } else if (colorSpace === ColorSpaceType.GRAY) {
      photometric = 1; // BlackIsZero
    }

    // Compress or store uncompressed pixel data
    let stripData;
    let compressionTag;
    if (compress) {
      stripData = zlib.deflateSync(image.data);
      compressionTag = 8; // Deflate
    } else {
      stripData = image.data;
      compressionTag = 1; // Uncompressed
    }

    // Embed ICC profile bytes if available
    let iccBytes = null;
    if (image.iccProfile && image.iccProfile.buffer) {
      iccBytes = image.iccProfile.buffer;
    }

    const tags = [];

    // Helper to add tag
    function addTag(tagId, tagType, count, valOrData) {
      tags.push({ tagId, tagType, count, valOrData });
    }

    addTag(256, 4, 1, width); // ImageWidth
    addTag(257, 4, 1, height); // ImageLength
    if (channels === 1) {
      addTag(258, 3, 1, bitsPerSample);
    } else {
      addTag(258, 3, channels, new Array(channels).fill(bitsPerSample));
    }
    addTag(259, 3, 1, compressionTag); // Compression
    addTag(262, 3, 1, photometric); // PhotometricInterpretation
    addTag(273, 4, 1, 0); // StripOffsets (placeholder)
    addTag(277, 3, 1, channels); // SamplesPerPixel
    addTag(278, 4, 1, height); // RowsPerStrip
    addTag(279, 4, 1, stripData.length); // StripByteCounts
    addTag(282, 5, 1, [Math.round(dpiX), 1]); // XResolution (Rational)
    addTag(283, 5, 1, [Math.round(dpiY), 1]); // YResolution (Rational)
    addTag(296, 3, 1, 2); // ResolutionUnit (2 = Inch)

    if (iccBytes) {
      addTag(34675, 7, iccBytes.length, iccBytes); // ICCProfile
    }

    // Sort tags by ID ascending as required by TIFF 6.0
    tags.sort((a, b) => a.tagId - b.tagId);

    // Calculate layout:
    // Header: 8 bytes (0..7)
    // IFD starts at offset 8
    // IFD length: 2 + tags.length * 12 + 4 (next IFD pointer = 0)
    const ifdOffset = 8;
    const ifdLength = 2 + tags.length * 12 + 4;
    let dataOffset = ifdOffset + ifdLength;

    // Collect extra data blocks (for tags with data > 4 bytes)
    const extraBlocks = [];

    for (const tag of tags) {
      let typeSize = 1;
      if (tag.tagType === 3) typeSize = 2; // SHORT
      else if (tag.tagType === 4) typeSize = 4; // LONG
      else if (tag.tagType === 5) typeSize = 8; // RATIONAL

      const totalBytes = tag.count * typeSize;

      if (totalBytes > 4) {
        tag.offset = dataOffset;
        extraBlocks.push({ offset: dataOffset, tag });
        dataOffset += totalBytes + (totalBytes & 1); // 2-byte alignment
      }
    }

    // Strip data offset
    const stripOffset = dataOffset;
    dataOffset += stripData.length + (stripData.length & 1);

    // Update StripOffsets tag
    const stripOffsetTag = tags.find(t => t.tagId === 273);
    stripOffsetTag.valOrData = stripOffset;

    // Allocate output buffer
    const out = new Uint8Array(dataOffset);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

    // 1. Header (Little Endian)
    out[0] = 0x49; // 'I'
    out[1] = 0x49; // 'I'
    view.setUint16(2, 42, true); // Magic 42
    view.setUint32(4, ifdOffset, true); // First IFD offset

    // 2. IFD Entries
    view.setUint16(ifdOffset, tags.length, true);
    let entryOffset = ifdOffset + 2;

    for (const tag of tags) {
      view.setUint16(entryOffset, tag.tagId, true);
      view.setUint16(entryOffset + 2, tag.tagType, true);
      view.setUint32(entryOffset + 4, tag.count, true);

      let typeSize = 1;
      if (tag.tagType === 3) typeSize = 2;
      else if (tag.tagType === 4) typeSize = 4;
      else if (tag.tagType === 5) typeSize = 8;

      const totalBytes = tag.count * typeSize;

      if (totalBytes <= 4) {
        if (tag.tagType === 3) {
          view.setUint16(entryOffset + 8, tag.valOrData, true);
        } else if (tag.tagType === 4) {
          view.setUint32(entryOffset + 8, tag.valOrData, true);
        } else {
          view.setUint32(entryOffset + 8, tag.valOrData, true);
        }
      } else {
        view.setUint32(entryOffset + 8, tag.offset, true);
      }

      entryOffset += 12;
    }

    view.setUint32(entryOffset, 0, true); // Next IFD = 0

    // 3. Write extra data blocks
    for (const { offset, tag } of extraBlocks) {
      if (tag.tagId === 258) { // BitsPerSample array
        for (let i = 0; i < tag.count; i++) {
          view.setUint16(offset + i * 2, tag.valOrData[i], true);
        }
      } else if (tag.tagType === 5) { // Rational (num, den)
        view.setUint32(offset, tag.valOrData[0], true);
        view.setUint32(offset + 4, tag.valOrData[1], true);
      } else if (tag.tagId === 34675) { // ICCProfile raw bytes
        out.set(tag.valOrData, offset);
      }
    }

    // 4. Write strip data
    out.set(stripData, stripOffset);

    return out;
  }
}
