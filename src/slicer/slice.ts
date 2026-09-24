import type { TriangleSoup } from './mesh';
import { area, cleanAndSimplify, SCALE, union, type Path, type Paths } from './geometry';

/** Z heights (top of each layer) for a model of the given height. */
export function layerHeights(modelHeight: number, firstLayer: number, layerHeight: number): number[] {
  const zs: number[] = [];
  if (modelHeight <= 0) return zs;
  let z = Math.min(firstLayer, modelHeight);
  zs.push(z);
  while (z + layerHeight * 0.5 < modelHeight) {
    z = Math.min(z + layerHeight, modelHeight);
    zs.push(+z.toFixed(4));
  }
  return zs;
}

interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * Intersects every triangle with horizontal planes and returns, for each
 * plane, the closed outlines (as Clipper paths) of the solid cross-section.
 */
export function sliceMesh(positions: TriangleSoup, planes: number[]): Paths[] {
  const segs: Segment[][] = planes.map(() => []);
  const n = positions.length / 9;
  // `planes` is sorted, so we can binary-search the first plane for each triangle.
  const firstPlaneAtOrAbove = (z: number) => {
    let lo = 0, hi = planes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (planes[mid] < z) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    for (let k = 0; k < 9; k++) v[k] = positions[o + k];
    const z0 = v[2], z1 = v[5], z2 = v[8];
    const zmin = Math.min(z0, z1, z2);
    const zmax = Math.max(z0, z1, z2);
    if (zmax === zmin) continue; // flat triangles don't contribute outlines

    // Outline direction must be z × normal so outer loops are counter-clockwise.
    const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2];
    const wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;

    // `<=`: a triangle whose top vertex lies exactly on the plane still crosses it
    // (that vertex counts as above), so it must not be skipped.
    for (let p = firstPlaneAtOrAbove(zmin); p < planes.length && planes[p] <= zmax; p++) {
      const z = planes[p];
      const pts: number[] = [];
      for (let e = 0; e < 3; e++) {
        const i = e * 3;
        const j = ((e + 1) % 3) * 3;
        const za = v[i + 2], zb = v[j + 2];
        // A vertex exactly on the plane counts as "above", so every crossing is counted once.
        if ((za < z) !== (zb < z)) {
          // Interpolate from the lower vertex so shared edges produce identical points.
          const [lo, hi] = za < zb ? [i, j] : [j, i];
          const f = (z - v[lo + 2]) / (v[hi + 2] - v[lo + 2]);
          pts.push(v[lo] + (v[hi] - v[lo]) * f, v[lo + 1] + (v[hi + 1] - v[lo + 1]) * f);
        }
      }
      if (pts.length !== 4) continue;
      let [ax, ay, bx, by] = pts;
      // A triangle touching the plane with just one vertex gives a zero-length segment.
      if (Math.abs(ax - bx) < 1e-7 && Math.abs(ay - by) < 1e-7) continue;
      if ((bx - ax) * -ny + (by - ay) * nx < 0) [ax, ay, bx, by] = [bx, by, ax, ay];
      segs[p].push({ ax, ay, bx, by });
    }
  }

  return segs.map(chainSegments);
}

const key = (x: number, y: number) => `${Math.round(x * SCALE)},${Math.round(y * SCALE)}`;

/** Joins loose segments end-to-start into closed loops, then unions them into a region. */
export function chainSegments(segments: Segment[]): Paths {
  if (segments.length === 0) return [];
  const byStart = new Map<string, number[]>();
  segments.forEach((s, i) => {
    const k = key(s.ax, s.ay);
    const list = byStart.get(k);
    if (list) list.push(i);
    else byStart.set(k, [i]);
  });

  const used = new Uint8Array(segments.length);
  const loops: Paths = [];
  const takeFrom = (k: string): number => {
    const list = byStart.get(k);
    if (!list) return -1;
    while (list.length) {
      const i = list.pop()!;
      if (!used[i]) return i;
    }
    return -1;
  };

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const loop: Path = [];
    const s0 = segments[start];
    loop.push({ X: Math.round(s0.ax * SCALE), Y: Math.round(s0.ay * SCALE) });
    let cur = s0;
    const startKey = key(s0.ax, s0.ay);
    for (let guard = 0; guard < segments.length; guard++) {
      const endKey = key(cur.bx, cur.by);
      if (endKey === startKey) break;
      loop.push({ X: Math.round(cur.bx * SCALE), Y: Math.round(cur.by * SCALE) });
      let next = takeFrom(endKey);
      if (next < 0) next = nearestUnusedStart(segments, used, cur.bx, cur.by, 0.05);
      if (next < 0) break; // open loop: Clipper will close it
      used[next] = 1;
      cur = segments[next];
    }
    if (loop.length >= 3) loops.push(loop);
  }

  let region = union(loops);
  // Meshes with inverted normals produce negative area: flip them.
  if (area(region) < 0 || (region.length === 0 && loops.length > 0)) {
    region = union(loops.map((l) => l.slice().reverse()));
  }
  return cleanAndSimplify(region);
}

/** Fallback for small gaps in non-manifold meshes. */
function nearestUnusedStart(segments: Segment[], used: Uint8Array, x: number, y: number, maxDist: number): number {
  let best = -1;
  let bestD = maxDist * maxDist;
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    const dx = segments[i].ax - x, dy = segments[i].ay - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
