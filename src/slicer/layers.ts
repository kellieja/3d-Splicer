import type { PrintSettings } from '../types';
import type { TriangleSoup } from './mesh';
import { layerHeights } from './slice';

/*
 * Variable layer height.
 *
 * Adaptive: the visible "stair steps" on a slope are about layer height ×
 * how much the surface faces up. So curves and shallow slopes get thin layers
 * and straight vertical walls (and flat tops) get thick ones.
 * Manual ranges override everything inside them.
 */

export interface LayerHeightLimits {
  min: number;
  max: number;
}

export function layerHeightLimits(nozzle: number): LayerHeightLimits {
  return { min: Math.max(0.04, +(nozzle * 0.2).toFixed(2)), max: +(nozzle * 0.75).toFixed(2) };
}

/** Top Z of every layer, honouring adaptive layers and manual ranges. */
export function computeLayerHeights(positions: TriangleSoup, modelHeight: number, s: PrintSettings): number[] {
  const ranges = (s.layerRanges ?? []).filter((r) => r.to > r.from && r.height > 0);
  if (!s.adaptiveLayers && ranges.length === 0) return layerHeights(modelHeight, s.firstLayerHeight, s.layerHeight);
  if (modelHeight <= 0) return [];

  const lim = layerHeightLimits(s.nozzleDiameter);
  const q = Math.min(1, Math.max(0, (s.adaptiveQuality ?? 50) / 100));
  // Allowed stair-step size: large when q = 0 (speed), small when q = 1 (detail).
  const cusp = lim.max * 0.6 * (1 - q) + lim.min * 0.35 * q;

  // Bucket sloped triangles by height so each layer only looks at nearby ones.
  const BIN = 1;
  const bins: number[][] = [];
  const zmin: number[] = [], zmax: number[] = [], slope: number[] = [];
  if (s.adaptiveLayers) {
    for (let i = 0; i < positions.length; i += 9) {
      const ux = positions[i + 3] - positions[i], uy = positions[i + 4] - positions[i + 1], uz = positions[i + 5] - positions[i + 2];
      const vx = positions[i + 6] - positions[i], vy = positions[i + 7] - positions[i + 1], vz = positions[i + 8] - positions[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len === 0) continue;
      const cz = Math.abs(nz / len);
      // Vertical walls need no thin layers; flat tops just need a layer boundary.
      if (cz < 0.02 || cz > 0.995) continue;
      const lo = Math.min(positions[i + 2], positions[i + 5], positions[i + 8]);
      const hi = Math.max(positions[i + 2], positions[i + 5], positions[i + 8]);
      const t = zmin.length;
      zmin.push(lo); zmax.push(hi); slope.push(cz);
      for (let b = Math.floor(lo / BIN); b <= Math.floor(hi / BIN); b++) (bins[b] ??= []).push(t);
    }
  }

  const adaptiveAt = (z: number): number => {
    let h = lim.max;
    const top = z + lim.max;
    for (let b = Math.floor(z / BIN); b <= Math.floor(top / BIN); b++) {
      for (const t of bins[b] ?? []) {
        if (zmax[t] < z || zmin[t] > top) continue;
        h = Math.min(h, cusp / slope[t]);
      }
    }
    return Math.max(lim.min, Math.min(lim.max, h));
  };

  const zs: number[] = [];
  let z = Math.min(s.firstLayerHeight, modelHeight);
  zs.push(+z.toFixed(4));
  let prev = s.firstLayerHeight;
  while (z < modelHeight - 1e-6) {
    const range = ranges.find((r) => z >= r.from - 1e-6 && z < r.to - 1e-6);
    let h: number;
    if (range) {
      h = Math.max(0.04, Math.min(s.nozzleDiameter * 0.8, range.height));
      // Don't run past the end of the range by more than a sliver.
      if (range.to - z > h * 0.5) h = Math.min(h, range.to - z);
    } else {
      // Adaptive layers grow gently (at most +50 % per layer) so walls stay smooth.
      h = s.adaptiveLayers ? Math.min(adaptiveAt(z), prev * 1.5) : s.layerHeight;
      // Land exactly on the start of the next manual range.
      const next = ranges.filter((r) => r.from > z + 1e-6).sort((a, b) => a.from - b.from)[0];
      if (next && next.from - z > 0.04 && next.from - z < h + lim.min * 0.5) h = next.from - z;
    }
    if (modelHeight - (z + h) < Math.min(lim.min, h) * 0.5) h = modelHeight - z; // finish exactly at the top
    z += h;
    prev = h;
    zs.push(+z.toFixed(4));
  }
  return zs;
}
