/**
 * @file scenarios.js
 * @description Standardized performance benchmark workloads for Poltergeist prepress operations.
 * Measures throughput in Megapixels per second (MP/s) and Megabytes per second (MB/s).
 */

import { RasterImage, ColorSpaceType, PixelFormat } from '../src/types/image.js';
import { LayeredImage, LayerRecord } from '../src/types/layer.js';
import { downsampleForPrepress } from '../src/compositor/resample/resample.js';
import { ColorTransform } from '../src/color/transform/transform.js';
import { IccProfile } from '../src/color/icc/profile.js';
import { TacLimiter } from '../src/color/tac/tac_limiter.js';
import { RgbColor } from '../src/types/color.js';
import { RawMetadata, CfaPattern } from '../src/ingestion/raw/cfa.js';
import { RawDemosaicer } from '../src/ingestion/raw/demosaic.js';
import { TransparencyFlattener } from '../src/compositor/flattener/transparency_flattener.js';
import { SeparationPlateGenerator } from '../src/export/tiffsep/plate_generator.js';
import { JpegDecoder } from '../src/ingestion/raster/jpeg/jpeg_decoder.js';
import { JpegWriter } from '../src/export/jpeg/jpeg_writer.js';
import { convert, ExportFormat } from '../src/pipeline/convert.js';

export const BENCHMARK_SCENARIOS = [
  {
    name: 'Prepress Resampling (Bicubic Downsampling 600 -> 300 DPI)',
    setup() {
      const width = 800;
      const height = 800;
      const data = new Uint8Array(width * height * 3);
      for (let i = 0; i < data.length; i++) data[i] = (i * 17) & 0xff;
      return new RasterImage({
        width,
        height,
        channels: 3,
        dpiX: 600,
        dpiY: 600,
        data
      });
    },
    run(image) {
      return downsampleForPrepress(image, { targetDpi: 300, thresholdDpi: 450 });
    },
    megapixels(image) {
      return (image.width * image.height) / 1_000_000;
    },
    megabytes(image) {
      return image.data.byteLength / (1024 * 1024);
    }
  },

  {
    name: 'Color Management (sRGB -> DeviceCMYK Tetrahedral LUT + TAC 300%)',
    setup() {
      const width = 400;
      const height = 400;
      const numPixels = width * height;
      const srcProfile = IccProfile.createSrgbProfile();
      const destProfile = IccProfile.createCmykReferenceProfile();
      const transform = new ColorTransform({
        sourceProfile: srcProfile,
        destinationProfile: destProfile,
        tacLimiter: new TacLimiter({ maxTac: 300 })
      });
      const pixels = [];
      for (let i = 0; i < numPixels; i++) {
        pixels.push(new RgbColor((i & 0xff) / 255.0, ((i >> 4) & 0xff) / 255.0, ((i >> 8) & 0xff) / 255.0));
      }
      return { transform, pixels, numPixels };
    },
    run({ transform, pixels }) {
      for (let i = 0; i < pixels.length; i++) {
        transform.transform(pixels[i]);
      }
    },
    megapixels({ numPixels }) {
      return numPixels / 1_000_000;
    },
    megabytes({ numPixels }) {
      return (numPixels * 3) / (1024 * 1024);
    }
  },

  {
    name: 'Layer Compositing & Transparency Flattening (5 Layers RGBA)',
    setup() {
      const width = 500;
      const height = 500;
      const layers = [];
      for (let l = 0; l < 5; l++) {
        const data = new Uint8Array(width * height * 4);
        data.fill((l + 1) * 40);
        layers.push(new LayerRecord({
          name: `Layer ${l}`,
          width,
          height,
          channels: 4,
          data,
          opacity: 0.8
        }));
      }
      return new LayeredImage({ width, height, layers });
    },
    run(layered) {
      return TransparencyFlattener.flattenToRaster(layered);
    },
    megapixels(layered) {
      return (layered.width * layered.height * 5) / 1_000_000;
    },
    megabytes(layered) {
      return (layered.width * layered.height * 4 * 5) / (1024 * 1024);
    }
  },

  {
    name: 'Camera RAW Demosaicing (1 Megapixel Bayer RGGB Sensel Mosaic)',
    setup() {
      const width = 1000;
      const height = 1000;
      const cfaData = new Uint16Array(width * height);
      for (let i = 0; i < cfaData.length; i++) cfaData[i] = (i * 31) & 0xffff;
      const metadata = new RawMetadata({
        width,
        height,
        cfaPattern: CfaPattern.RGGB,
        whiteLevel: 65535
      });
      return { cfaData, metadata };
    },
    run({ cfaData, metadata }) {
      return RawDemosaicer.demosaic(cfaData, metadata);
    },
    megapixels({ metadata }) {
      return (metadata.width * metadata.height) / 1_000_000;
    },
    megabytes({ cfaData }) {
      return cfaData.byteLength / (1024 * 1024);
    }
  },

  {
    name: 'Prepress Plate Separation (CMYK Separation Plates tiffsep)',
    setup() {
      const width = 600;
      const height = 600;
      const data = new Uint8Array(width * height * 4);
      data.fill(128);
      return new RasterImage({
        width,
        height,
        channels: 4,
        colorSpace: ColorSpaceType.CMYK,
        pixelFormat: PixelFormat.CMYK32,
        dpiX: 300,
        dpiY: 300,
        data
      });
    },
    run(cmykImage) {
      return SeparationPlateGenerator.generatePlates(cmykImage, { jobName: 'bench' });
    },
    megapixels(cmykImage) {
      return (cmykImage.width * cmykImage.height) / 1_000_000;
    },
    megabytes(cmykImage) {
      return (cmykImage.width * cmykImage.height * 4) / (1024 * 1024);
    }
  },

  {
    name: 'JPEG Ingestion & Scaled IDCT (1/4 Scale 2x2 IDCT)',
    setup() {
      const width = 800;
      const height = 800;
      const data = new Uint8Array(width * height * 3);
      for (let i = 0; i < data.length; i++) data[i] = (i * 23) & 0xff;
      const image = new RasterImage({
        width,
        height,
        channels: 3,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.RGB,
        pixelFormat: PixelFormat.RGB24,
        dpiX: 300,
        dpiY: 300,
        data
      });
      const jpegBytes = JpegWriter.write(image, { quality: 85 });
      return { jpegBytes, width, height };
    },
    run({ jpegBytes }) {
      return JpegDecoder.decode(jpegBytes, { scaleDenom: 4 });
    },
    megapixels({ width, height }) {
      return (width * height) / 1_000_000;
    },
    megabytes({ jpegBytes }) {
      return jpegBytes.byteLength / (1024 * 1024);
    }
  },

  {
    name: 'JPEG Export Encoding (Pure Native JpegWriter Baseline)',
    setup() {
      const width = 800;
      const height = 800;
      const data = new Uint8Array(width * height * 3);
      for (let i = 0; i < data.length; i++) data[i] = (i * 23) & 0xff;
      return new RasterImage({
        width,
        height,
        channels: 3,
        bitsPerSample: 8,
        colorSpace: ColorSpaceType.RGB,
        pixelFormat: PixelFormat.RGB24,
        dpiX: 300,
        dpiY: 300,
        data
      });
    },
    run(image) {
      return JpegWriter.write(image, { quality: 85, dpiX: 72, dpiY: 72 });
    },
    megapixels(image) {
      return (image.width * image.height) / 1_000_000;
    },
    megabytes(image) {
      return image.data.byteLength / (1024 * 1024);
    }
  }
];
