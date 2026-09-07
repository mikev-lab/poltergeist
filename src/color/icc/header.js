/**
 * @fileoverview 128-byte ICC profile header parser.
 * Strict binary parsing conforming to ICC.1:2010 (v4.3) and ICC.1:2001-04 (v2.4).
 */

import { RenderingIntent, D50 } from '../../types/color.js';

/**
 * Reads a 4-character ASCII string from a DataView.
 * @param {DataView} view
 * @param {number} offset
 * @returns {string}
 */
export function readAscii4(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

/**
 * Reads an s15Fixed16Number (signed 16.16 fixed-point) from a DataView.
 * @param {DataView} view
 * @param {number} offset
 * @returns {number}
 */
export function readS15Fixed16(view, offset) {
  return view.getInt32(offset, false) / 65536.0;
}

/**
 * Writes an s15Fixed16Number into a DataView.
 * @param {DataView} view
 * @param {number} offset
 * @param {number} value
 */
export function writeS15Fixed16(view, offset, value) {
  view.setInt32(offset, Math.round(value * 65536.0), false);
}

/**
 * Represents the parsed 128-byte ICC Profile Header.
 */
export class IccHeader {
  /**
   * @param {Object} fields
   */
  constructor(fields) {
    this.profileSize = fields.profileSize;
    this.cmmType = fields.cmmType;
    this.versionMajor = fields.versionMajor;
    this.versionMinor = fields.versionMinor;
    this.version = fields.version;
    this.deviceClass = fields.deviceClass;
    this.colorSpace = fields.colorSpace;
    this.pcs = fields.pcs;
    this.createdAt = fields.createdAt;
    this.signature = fields.signature;
    this.platform = fields.platform;
    this.flags = fields.flags;
    this.manufacturer = fields.manufacturer;
    this.model = fields.model;
    this.renderingIntent = fields.renderingIntent;
    this.illuminant = fields.illuminant;
    this.creator = fields.creator;
    this.profileId = fields.profileId;
    Object.freeze(this);
  }

  /**
   * Parses 128 bytes from a Buffer or Uint8Array.
   * @param {Uint8Array|ArrayBuffer} buffer
   * @param {number} [offset=0]
   * @returns {IccHeader}
   */
  static fromBuffer(buffer, offset = 0) {
    const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (uint8.length < offset + 128) {
      throw new RangeError(
        `Buffer too small for ICC header: requires 128 bytes, available ${uint8.length - offset}`
      );
    }

    const view = new DataView(uint8.buffer, uint8.byteOffset + offset, 128);

    // Byte 0-3: Profile size
    const profileSize = view.getUint32(0, false);
    if (profileSize > uint8.length - offset) {
      throw new RangeError(
        `ICC profileSize in header (${profileSize} bytes) exceeds buffer length (${uint8.length - offset} bytes)`
      );
    }

    // Byte 4-7: CMM type
    const cmmType = readAscii4(view, 4);

    // Byte 8-11: Profile version
    const versionMajor = view.getUint8(8);
    const versionMinor = (view.getUint8(9) >> 4) & 0x0f;
    const versionBugfix = view.getUint8(9) & 0x0f;
    const version = `${versionMajor}.${versionMinor}.${versionBugfix}`;

    // Byte 12-15: Profile/Device Class
    const deviceClass = readAscii4(view, 12);

    // Byte 16-19: Data color space
    const colorSpace = readAscii4(view, 16);

    // Byte 20-23: Profile Connection Space
    const pcs = readAscii4(view, 20);

    // Byte 24-35: Creation Date/Time
    const year = view.getUint16(24, false);
    const month = view.getUint16(26, false);
    const day = view.getUint16(28, false);
    const hours = view.getUint16(30, false);
    const minutes = view.getUint16(32, false);
    const seconds = view.getUint16(34, false);
    const createdAt = new Date(Date.UTC(year, Math.max(0, month - 1), day, hours, minutes, seconds));

    // Byte 36-39: Magic signature ("acsp")
    const signature = readAscii4(view, 36);
    if (signature !== 'acsp') {
      throw new Error(`Invalid ICC signature: expected 'acsp', encountered '${signature}'`);
    }

    // Byte 40-43: Primary platform
    const platform = readAscii4(view, 40);

    // Byte 44-47: Flags
    const flags = view.getUint32(44, false);

    // Byte 48-51: Device manufacturer
    const manufacturer = readAscii4(view, 48);

    // Byte 52-55: Device model
    const model = readAscii4(view, 52);

    // Byte 64-67: Rendering intent
    const renderingIntent = view.getUint32(64, false);

    // Byte 68-79: PCS illuminant XYZ
    const illX = readS15Fixed16(view, 68);
    const illY = readS15Fixed16(view, 72);
    const illZ = readS15Fixed16(view, 76);

    // Byte 80-83: Profile creator
    const creator = readAscii4(view, 80);

    // Byte 84-99: Profile ID (MD5)
    const profileId = new Uint8Array(uint8.buffer, uint8.byteOffset + offset + 84, 16);

    return new IccHeader({
      profileSize,
      cmmType,
      versionMajor,
      versionMinor,
      version,
      deviceClass,
      colorSpace,
      pcs,
      createdAt,
      signature,
      platform,
      flags,
      manufacturer,
      model,
      renderingIntent,
      illuminant: { X: illX, Y: illY, Z: illZ },
      creator,
      profileId,
    });
  }

  /**
   * Serializes this header into a 128-byte Uint8Array.
   * @param {number} actualSize Total profile byte size
   * @returns {Uint8Array}
   */
  serialize(actualSize = 128) {
    const buffer = new Uint8Array(128);
    const view = new DataView(buffer.buffer);

    view.setUint32(0, actualSize, false);
    for (let i = 0; i < 4; i++) {
      view.setUint8(4 + i, (this.cmmType || '    ').charCodeAt(i));
    }
    view.setUint8(8, this.versionMajor || 4);
    view.setUint8(9, ((this.versionMinor || 3) << 4));

    for (let i = 0; i < 4; i++) {
      view.setUint8(12 + i, (this.deviceClass || 'mntr').charCodeAt(i));
      view.setUint8(16 + i, (this.colorSpace || 'RGB ').charCodeAt(i));
      view.setUint8(20 + i, (this.pcs || 'XYZ ').charCodeAt(i));
    }

    // Date
    const now = this.createdAt || new Date();
    view.setUint16(24, now.getUTCFullYear(), false);
    view.setUint16(26, now.getUTCMonth() + 1, false);
    view.setUint16(28, now.getUTCDate(), false);
    view.setUint16(30, now.getUTCHours(), false);
    view.setUint16(32, now.getUTCMinutes(), false);
    view.setUint16(34, now.getUTCSeconds(), false);

    // Signature 'acsp'
    view.setUint8(36, 0x61);
    view.setUint8(37, 0x63);
    view.setUint8(38, 0x73);
    view.setUint8(39, 0x70);

    // Platform
    for (let i = 0; i < 4; i++) {
      view.setUint8(40 + i, (this.platform || '    ').charCodeAt(i));
      view.setUint8(48 + i, (this.manufacturer || '    ').charCodeAt(i));
      view.setUint8(52 + i, (this.model || '    ').charCodeAt(i));
      view.setUint8(80 + i, (this.creator || '    ').charCodeAt(i));
    }

    view.setUint32(64, this.renderingIntent || RenderingIntent.PERCEPTUAL, false);

    // Standard D50 Illuminant
    const ill = this.illuminant || D50;
    writeS15Fixed16(view, 68, ill.X);
    writeS15Fixed16(view, 72, ill.Y);
    writeS15Fixed16(view, 76, ill.Z);

    return buffer;
  }
}
