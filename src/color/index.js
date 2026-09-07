/**
 * @fileoverview Poltergeist Color Subsystem Public API.
 * Standalone, zero-dependency mathematical color engine.
 */

export {
  RenderingIntent,
  D50,
  RgbColor,
  CmykColor,
  XyzColor,
  LabColor,
  SpotColor,
  clamp,
} from '../types/color.js';

export {
  IccHeader,
  readAscii4,
  readS15Fixed16,
  writeS15Fixed16,
} from './icc/header.js';

export {
  ToneReproductionCurve,
  LinearCurve,
  GammaCurve,
  SampledCurve,
  ParametricCurve,
} from './icc/trc.js';

export {
  MultidimensionalLut,
  Lut8,
  Lut16,
  LutAtoB,
  LutBtoA,
} from './icc/lut.js';

export {
  IccTagEntry,
  parseXyzTag,
  parseDescTag,
  parseTagTable,
} from './icc/tags.js';

export {
  IccProfile,
} from './icc/profile.js';

export {
  D65,
  xyzToLab,
  labToXyz,
  computeBradfordMatrix,
  BRADFORD_D65_TO_D50,
  BRADFORD_D50_TO_D65,
  adaptXyz,
} from './transform/pcs.js';

export {
  interpolateTetrahedral3D,
  interpolateSimplex4D,
} from './transform/tetrahedral.js';

export {
  ColorTransform,
} from './transform/transform.js';

export {
  PrepressTacLimits,
  limitTac,
} from './tac/tac_limiter.js';

export {
  SeparationColorSpace,
  DeviceNColorSpace,
  StandardSpotColors,
} from './spot/spot_color.js';

export {
  simulateOverprint,
  simulateSpotOverprint,
} from './overprint/overprint.js';

export {
  ciede2000,
} from './metrics/ciede2000.js';
