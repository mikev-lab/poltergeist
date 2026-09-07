/**
 * @file writer.js
 * @description Pure binary PDF serializer, xref table generator, and trailer builder for Poltergeist.
 * Zero-dependency, bit-deterministic output.
 */

import { PdfStream, PdfDictionary, PdfReference, serializePdfValue } from './objects.js';

export class PdfWriter {
  /**
   * @param {string} [version='1.4'] PDF Version string (e.g. '1.3', '1.4', '1.6')
   */
  constructor(version = '1.4') {
    this.version = version;
    this.objects = [];
    this.rootRef = null;
    this.infoRef = null;
  }

  /**
   * Registers an object as an indirect object and returns its reference.
   * @param {any} obj 
   * @returns {PdfReference}
   */
  addObject(obj) {
    const num = this.objects.length + 1;
    const ref = new PdfReference(num, 0);
    this.objects.push({ num, gen: 0, obj });
    return ref;
  }

  /**
   * Compiles the entire PDF document into a binary Uint8Array.
   * @returns {Uint8Array}
   */
  compile() {
    const chunks = [];
    let currentOffset = 0;

    function writeString(str) {
      const buf = Buffer.from(str, 'latin1');
      chunks.push(buf);
      currentOffset += buf.length;
    }

    function writeBytes(bytes) {
      chunks.push(bytes);
      currentOffset += bytes.length;
    }

    // 1. PDF Header with binary marker comment
    writeString(`%PDF-${this.version}\n%\xE2\xE3\xCF\xD3\n`);

    // 2. Body: Indirect objects
    const offsets = new Array(this.objects.length);

    for (let i = 0; i < this.objects.length; i++) {
      const { num, gen, obj } = this.objects[i];
      offsets[i] = currentOffset;

      writeString(`${num} ${gen} obj\n`);

      if (obj instanceof PdfStream) {
        writeString(obj.dict.toString() + '\n');
        writeString('stream\n');
        writeBytes(obj.data);
        writeString('\nendstream\n');
      } else {
        writeString(serializePdfValue(obj) + '\n');
      }

      writeString('endobj\n');
    }

    // 3. Cross-Reference Table (xref)
    const xrefOffset = currentOffset;
    const totalObjs = this.objects.length + 1;
    writeString(`xref\n0 ${totalObjs}\n`);
    writeString('0000000000 65535 f \n');

    for (let i = 0; i < this.objects.length; i++) {
      const offStr = String(offsets[i]).padStart(10, '0');
      writeString(`${offStr} 00000 n \n`);
    }

    // 4. Trailer Dictionary
    const trailerDict = new PdfDictionary();
    trailerDict.set('Size', totalObjs);
    if (this.rootRef) {
      trailerDict.set('Root', this.rootRef);
    }
    if (this.infoRef) {
      trailerDict.set('Info', this.infoRef);
    }

    // Deterministic File ID
    writeString('trailer\n');
    writeString(trailerDict.toString() + '\n');
    writeString(`startxref\n${xrefOffset}\n%%EOF\n`);

    // Concatenate chunks
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(totalLength);
    let pos = 0;
    for (const chunk of chunks) {
      out.set(chunk, pos);
      pos += chunk.length;
    }

    return out;
  }
}
