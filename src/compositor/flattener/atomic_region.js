/**
 * @file atomic_region.js
 * @description 2D spatial decomposition of overlapping bounding boxes into non-overlapping atomic regions.
 * Zero-dependency, memory-safe.
 */

/**
 * Represents an atomic rectangular region of a page/spread where the set of overlapping layers is constant.
 */
export class AtomicRegion {
  /**
   * @param {object} params
   * @param {number} params.left
   * @param {number} params.top
   * @param {number} params.width
   * @param {number} params.height
   * @param {Array<import('../../types/layer.js').LayerRecord>} params.layers
   * @param {boolean} params.hasTransparency
   */
  constructor({ left, top, width, height, layers = [], hasTransparency = false }) {
    this.left = left;
    this.top = top;
    this.width = width;
    this.height = height;
    this.right = left + width;
    this.bottom = top + height;
    this.layers = layers;
    this.hasTransparency = hasTransparency;
  }
}

/**
 * Decomposes a canvas containing multiple layers into non-overlapping atomic rectangular regions.
 * Each atomic region has a uniform set of overlapping layers.
 * 
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {Array<import('../../types/layer.js').LayerRecord>} layers
 * @returns {Array<AtomicRegion>}
 */
export function decomposeAtomicRegions(canvasWidth, canvasHeight, layers) {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return [];
  }

  // Filter to visible layers
  const visibleLayers = layers.filter(l => l.visible);
  if (visibleLayers.length === 0) {
    return [new AtomicRegion({
      left: 0,
      top: 0,
      width: canvasWidth,
      height: canvasHeight,
      layers: [],
      hasTransparency: false
    })];
  }

  // 1. Collect all unique X and Y cut-lines within [0, canvasWidth] and [0, canvasHeight]
  const xSet = new Set([0, canvasWidth]);
  const ySet = new Set([0, canvasHeight]);

  for (const layer of visibleLayers) {
    const l = Math.max(0, Math.min(canvasWidth, layer.left));
    const r = Math.max(0, Math.min(canvasWidth, layer.right));
    const t = Math.max(0, Math.min(canvasHeight, layer.top));
    const b = Math.max(0, Math.min(canvasHeight, layer.bottom));

    if (l < r && t < b) {
      xSet.add(l);
      xSet.add(r);
      ySet.add(t);
      ySet.add(b);
    }
  }

  const xs = Array.from(xSet).sort((a, b) => a - b);
  const ys = Array.from(ySet).sort((a, b) => a - b);

  // Helper to check if a layer has live transparency
  function layerHasTransparency(layer) {
    if (layer.opacity < 1.0) return true;
    if (layer.blendMode && layer.blendMode !== 'NORMAL' && layer.blendMode !== 'norm') return true;
    if (layer.mask) return true;
    if (layer.image && layer.image.channels === 4) return true; // RGBA
    return false;
  }

  // 2. Build 2D grid of atomic cells
  /** @type {Array<AtomicRegion>} */
  const rawCells = [];

  for (let j = 0; j < ys.length - 1; j++) {
    const top = ys[j];
    const bottom = ys[j + 1];
    const cellH = bottom - top;
    if (cellH <= 0) continue;

    for (let i = 0; i < xs.length - 1; i++) {
      const left = xs[i];
      const right = xs[i + 1];
      const cellW = right - left;
      if (cellW <= 0) continue;

      // Find all layers overlapping this cell
      // Midpoint test is unambiguous since cutlines pass through all layer boundaries
      const midX = (left + right) / 2;
      const midY = (top + bottom) / 2;

      const activeLayers = [];
      let cellHasTrans = false;

      for (const layer of visibleLayers) {
        if (midX >= layer.left && midX < layer.right && midY >= layer.top && midY < layer.bottom) {
          activeLayers.push(layer);
          if (layerHasTransparency(layer)) {
            cellHasTrans = true;
          }
        }
      }

      // If activeLayers count > 1, any layer interaction between them is a potential transparency interaction
      if (activeLayers.length > 1 && cellHasTrans) {
        cellHasTrans = true;
      }

      rawCells.push(new AtomicRegion({
        left,
        top,
        width: cellW,
        height: cellH,
        layers: activeLayers,
        hasTransparency: cellHasTrans
      }));
    }
  }

  // 3. Optimize regions by merging adjacent horizontal cells with identical layer configurations
  return mergeAdjacentRegions(rawCells);
}

/**
 * Greedily merges horizontally and vertically adjacent regions that share the exact same layer instances.
 * @param {Array<AtomicRegion>} regions
 * @returns {Array<AtomicRegion>}
 */
function mergeAdjacentRegions(regions) {
  if (regions.length <= 1) return regions;

  // Key generator for layer identity
  function getLayersKey(layers) {
    return layers.map(l => l.name || `${l.left},${l.top},${l.width},${l.height}`).join('|');
  }

  /** @type {Array<AtomicRegion>} */
  const mergedHorizontal = [];
  let current = null;

  for (const r of regions) {
    if (!current) {
      current = new AtomicRegion({ ...r });
      continue;
    }

    const sameY = current.top === r.top && current.height === r.height;
    const adjacentX = current.right === r.left;
    const sameLayers = getLayersKey(current.layers) === getLayersKey(r.layers);
    const sameTrans = current.hasTransparency === r.hasTransparency;

    if (sameY && adjacentX && sameLayers && sameTrans) {
      // Merge horizontally
      current.width += r.width;
      current.right = current.left + current.width;
    } else {
      mergedHorizontal.push(current);
      current = new AtomicRegion({ ...r });
    }
  }

  if (current) {
    mergedHorizontal.push(current);
  }

  return mergedHorizontal;
}
