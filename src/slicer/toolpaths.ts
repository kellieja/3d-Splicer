import type { Layer, PathKind, PrintSettings, SeamPosition, ToolPath } from '../types';
import {
  area,
  bounds,
  clipLines,
  difference,
  intersection,
  islandPaths,
  offset,
  open,
  SCALE,
  splitIslands,
  union,
  type Path,
  type Paths,
} from './geometry';

export interface ToolpathOptions {
  settings: PrintSettings;
  /** Extrusion width in mm. */
  lineWidth: number;
  /** Top Z of every layer. */
  zs: number[];
  onProgress?: (fraction: number) => void;
}

/**
 * Turns the cross-section of each layer into printable paths:
 * walls (perimeters), solid top/bottom skin, sparse infill, supports and
 * skirt/brim.
 */
export function generateToolpaths(regions: Paths[], opts: ToolpathOptions): Layer[] {
  const { settings: s, lineWidth: lw, zs } = opts;
  const n = regions.length;
  const supports = s.supports ? computeSupportAreas(regions, zs, s, lw) : regions.map(() => []);
  const ironAreas = s.ironing ? topmostSurfaces(regions, lw) : regions.map(() => []);
  const layers: Layer[] = [];
  let seams: Pt[] = [];

  for (let i = 0; i < n; i++) {
    const region = regions[i];
    const height = i === 0 ? zs[0] : zs[i] - zs[i - 1];
    const paths: ToolPath[] = [];

    if (i === 0) paths.push(...adhesionPaths(union(region, supports[0]), s, lw));

    // Region that must be solid: not covered by enough layers above or below.
    const solidMask = union(
      difference(region, coverage(regions, i + 1, i + s.topLayers)),
      difference(region, coverage(regions, i - s.bottomLayers, i - 1)),
    );

    let islands = splitIslands(region);
    islands = orderByNearest(islands, (isl) => isl.outer[0]);

    for (const island of islands) {
      const shape = islandPaths(island);
      const walls: Paths[] = [];
      let loop = offset(shape, -lw / 2);
      for (let w = 0; w < s.wallCount && loop.length; w++) {
        walls.push(loop);
        loop = offset(loop, -lw);
      }
      // Print inner walls first, outer wall last, for a cleaner surface.
      for (let w = walls.length - 1; w >= 0; w--) {
        const kind: PathKind = w === 0 ? 'outer-wall' : 'inner-wall';
        for (const p of walls[w]) paths.push(closedPath(kind, p));
      }

      // Area inside the walls, overlapping the innermost wall by 15 %.
      const inset = s.wallCount > 0 ? walls.length * lw - 0.15 * lw : lw / 2;
      const fill = offset(shape, -inset);
      if (fill.length === 0) continue;

      const solid = open(intersection(fill, solidMask), lw);
      const sparse = difference(fill, solid);

      if (solid.length) {
        const angle = i % 2 === 0 ? 45 : -45;
        paths.push(...linePaths('solid-infill', fillLines(solid, lw, angle)));
      }
      if (sparse.length && s.infillDensity > 0) {
        if (s.infillDensity >= 99) {
          paths.push(...linePaths('solid-infill', fillLines(sparse, lw, i % 2 === 0 ? 45 : -45)));
        } else {
          paths.push(...linePaths('sparse-infill', sparseInfill(sparse, lw, s, i)));
        }
      }
    }

    if (supports[i].length) {
      const spacing = lw / Math.max(0.05, s.supportDensity / 100);
      paths.push(...linePaths('support', fillLines(supports[i], spacing, i === 0 ? 90 : 0, true)));
    }

    if (ironAreas[i].length) {
      // Cross the top skin lines so the nozzle smooths over the ridges.
      const angle = (i % 2 === 0 ? 45 : -45) + 90;
      paths.push(...linePaths('ironing', fillLines(ironAreas[i], Math.max(0.05, s.ironingSpacing), angle, true)));
    }

    const seam: SeamContext = { mode: s.seam ?? 'aligned', layer: i, previous: seams, next: [] };
    layers.push({ index: i, z: zs[i], height, paths: orderPaths(paths, seam) });
    seams = seam.next;
    opts.onProgress?.((i + 1) / n);
  }
  return layers;
}

/**
 * The very top surfaces: the last layer of each part of the model (an island
 * with nothing printed on top of it), shrunk to stay inside the outer wall.
 * Steps partway up the model are not ironed.
 */
function topmostSurfaces(regions: Paths[], lw: number): Paths[] {
  return regions.map((region, i) => {
    const above = regions[i + 1] ?? [];
    const tops: Paths = [];
    for (const island of splitIslands(region)) {
      const shape = islandPaths(island);
      if (above.length && area(intersection(shape, above)) > 0.01) continue;
      tops.push(...shape);
    }
    return tops.length ? open(offset(tops, -lw / 2), lw) : [];
  });
}

/** Intersection of the regions of layers `from`..`to`. Empty if any layer is missing. */
function coverage(regions: Paths[], from: number, to: number): Paths {
  if (to < from) return [[{ X: -1e9, Y: -1e9 }, { X: 1e9, Y: -1e9 }, { X: 1e9, Y: 1e9 }, { X: -1e9, Y: 1e9 }]];
  if (from < 0 || to >= regions.length) return [];
  let acc = regions[from];
  for (let j = from + 1; j <= to && acc.length; j++) acc = intersection(acc, regions[j]);
  return acc;
}

function sparseInfill(region: Paths, lw: number, s: PrintSettings, layer: number): Paths {
  const d = s.infillDensity / 100;
  switch (s.infillPattern) {
    case 'lines':
      return fillLines(region, lw / d, layer % 2 === 0 ? 45 : -45);
    case 'grid':
      return [...fillLines(region, (2 * lw) / d, 45), ...fillLines(region, (2 * lw) / d, -45)];
    case 'triangles':
      return [0, 60, 120].flatMap((a) => fillLines(region, (3 * lw) / d, a));
  }
}

/**
 * Parallel lines covering `region` at `spacingMm`, rotated by `angleDeg`.
 * Lines sit on a global grid so they line up from layer to layer.
 */
export function fillLines(region: Paths, spacingMm: number, angleDeg: number, zigzag = false): Paths {
  if (region.length === 0) return [];
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  // Rotate region by -angle so we can generate horizontal lines.
  const rotated = region.map((p) => p.map((pt) => ({ X: pt.X * cos + pt.Y * sin, Y: -pt.X * sin + pt.Y * cos })));
  const b = bounds(rotated);
  const spacing = spacingMm * SCALE;
  const lines: Paths = [];
  const startK = Math.ceil(b.minY / spacing);
  for (let k = startK; k * spacing <= b.maxY; k++) {
    const y = k * spacing;
    const x0 = b.minX - SCALE, x1 = b.maxX + SCALE;
    const [ax, bx] = k % 2 === 0 || !zigzag ? [x0, x1] : [x1, x0];
    // Rotate back to printer coordinates.
    lines.push([
      { X: Math.round(ax * cos - y * sin), Y: Math.round(ax * sin + y * cos) },
      { X: Math.round(bx * cos - y * sin), Y: Math.round(bx * sin + y * cos) },
    ]);
  }
  return clipLines(lines, region).filter((l) => pathLength(l) > 0.3 * SCALE);
}

function computeSupportAreas(regions: Paths[], zs: number[], s: PrintSettings, lw: number): Paths[] {
  const n = regions.length;
  const out: Paths[] = regions.map(() => []);
  const xyGap = lw * 1.5;
  const zGapLayers = 1;
  const angle = (Math.min(89, Math.max(1, s.supportAngle)) * Math.PI) / 180;
  let carried: Paths = [];
  for (let i = n - 2; i >= 0; i--) {
    const above = i + 1 + zGapLayers;
    let overhang: Paths = [];
    if (above < n) {
      const h = zs[above] - zs[i];
      // Anything that sticks out further than the allowed slope needs support.
      overhang = difference(regions[above], offset(regions[i], h * Math.tan(angle)));
    }
    // Overhang strips are thin on each layer but add up to wide areas further
    // down, so the XY gap and sliver removal only apply to what gets printed.
    // Support stops where it lands on the model.
    // Strips from consecutive layers leave small gaps, so close them (grow, then shrink).
    carried = offset(offset(union(carried, overhang), lw), -lw);
    carried = difference(carried, regions[i]);
    out[i] = open(difference(carried, offset(regions[i], xyGap)), lw);
  }
  return out;
}

function adhesionPaths(firstLayer: Paths, s: PrintSettings, lw: number): ToolPath[] {
  if (firstLayer.length === 0 || s.adhesion === 'none') return [];
  const loops: ToolPath[] = [];
  if (s.adhesion === 'brim') {
    const count = Math.max(1, Math.round(s.brimWidth / lw));
    // Outermost first so the print ends right next to the part.
    for (let k = count - 1; k >= 0; k--) {
      for (const p of offset(firstLayer, lw / 2 + k * lw, true)) loops.push(closedPath('skirt', p));
    }
  } else {
    const hull = offset(offset(firstLayer, s.skirtDistance + 3, true), -3, true);
    for (let k = Math.max(1, s.skirtLoops) - 1; k >= 0; k--) {
      for (const p of offset(hull, k * lw, true)) loops.push(closedPath('skirt', p));
    }
  }
  return loops;
}

function closedPath(kind: PathKind, p: Path): ToolPath {
  const points: number[] = [];
  for (const pt of p) points.push(pt.X / SCALE, pt.Y / SCALE);
  return { kind, points, closed: true };
}

function linePaths(kind: PathKind, lines: Paths): ToolPath[] {
  return lines.map((l) => {
    const points: number[] = [];
    for (const pt of l) points.push(pt.X / SCALE, pt.Y / SCALE);
    return { kind, points, closed: false };
  });
}

function pathLength(p: Path): number {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].X - p[i - 1].X, p[i].Y - p[i - 1].Y);
  return d;
}

function orderByNearest<T>(items: T[], pos: (t: T) => { X: number; Y: number }): T[] {
  if (items.length < 2) return items;
  const left = items.slice();
  const out: T[] = [];
  let cur = { X: 0, Y: 0 };
  while (left.length) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < left.length; i++) {
      const p = pos(left[i]);
      const d = (p.X - cur.X) ** 2 + (p.Y - cur.Y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const [item] = left.splice(best, 1);
    out.push(item);
    cur = pos(item);
  }
  return out;
}

const KIND_ORDER: PathKind[] = ['skirt', 'inner-wall', 'outer-wall', 'solid-infill', 'sparse-infill', 'support', 'ironing'];

/**
 * Reduces travel: keeps walls grouped per island as generated, and orders
 * infill/support lines greedily, flipping lines to start at the near end
 * and starting closed loops at the vertex nearest the nozzle.
 */
function orderPaths(paths: ToolPath[], seam: SeamContext): ToolPath[] {
  const out: ToolPath[] = [];
  let x = 0, y = 0;
  const emit = (p: ToolPath) => {
    out.push(p);
    const k = p.closed ? 0 : p.points.length - 2;
    x = p.points[k];
    y = p.points[k + 1];
  };

  // Skirt and walls keep their generated order (island by island).
  const loops = paths.filter((p) => p.kind === 'skirt' || p.kind.endsWith('wall'));
  loops.forEach((p, n) => {
    const start = p.kind === 'skirt' ? nearestVertex(p, x, y) : seamVertex(p, seam, x, y, n);
    const rotated = rotateLoop(p, start);
    if (p.kind === 'outer-wall') seam.next.push({ x: rotated.points[0], y: rotated.points[1] });
    emit(rotated);
  });

  for (const kind of KIND_ORDER.slice(3)) {
    const left = paths.filter((p) => p.kind === kind);
    while (left.length) {
      let best = 0, bestD = Infinity, flip = false;
      for (let i = 0; i < left.length; i++) {
        const pts = left[i].points;
        const d0 = (pts[0] - x) ** 2 + (pts[1] - y) ** 2;
        const d1 = (pts[pts.length - 2] - x) ** 2 + (pts[pts.length - 1] - y) ** 2;
        if (d0 < bestD) { bestD = d0; best = i; flip = false; }
        if (d1 < bestD) { bestD = d1; best = i; flip = true; }
      }
      const [p] = left.splice(best, 1);
      emit(flip ? reversePath(p) : p);
    }
  }
  return out;
}

function reversePath(p: ToolPath): ToolPath {
  const pts: number[] = [];
  for (let i = p.points.length - 2; i >= 0; i -= 2) pts.push(p.points[i], p.points[i + 1]);
  return { ...p, points: pts };
}

interface Pt { x: number; y: number }

interface SeamContext {
  mode: SeamPosition;
  layer: number;
  /** Where outer walls started on the layer below. */
  previous: Pt[];
  /** Filled in with this layer's outer-wall starts. */
  next: Pt[];
}

/** Index (into points, step 2) of the vertex nearest to (x, y). */
function nearestVertex(p: ToolPath, x: number, y: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < p.points.length; i += 2) {
    const d = (p.points[i] - x) ** 2 + (p.points[i + 1] - y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** How sharp the corner at vertex i is: 0 = straight, 1 = folded back. */
function cornerSharpness(pts: number[], i: number): number {
  const n = pts.length;
  const px = pts[(i - 2 + n) % n], py = pts[(i - 1 + n) % n];
  const nx = pts[(i + 2) % n], ny = pts[(i + 3) % n];
  const ax = pts[i] - px, ay = pts[i + 1] - py, bx = nx - pts[i], by = ny - pts[i + 1];
  const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
  if (la < 1e-6 || lb < 1e-6) return 0;
  return (1 - (ax * bx + ay * by) / (la * lb)) / 2;
}

/** Deterministic pseudo-random number in [0, 1) so re-slicing gives the same G-code. */
function hash01(a: number, b: number): number {
  let h = (a * 73856093) ^ (b * 19349663) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Chooses where a wall loop starts, following the seam setting. */
function seamVertex(p: ToolPath, ctx: SeamContext, x: number, y: number, loopIndex: number): number {
  const pts = p.points;
  const count = pts.length / 2;
  if (!p.closed || count < 3) return 0;
  switch (ctx.mode) {
    case 'nearest':
      return nearestVertex(p, x, y);
    case 'random':
      return Math.floor(hash01(ctx.layer, loopIndex * 7919 + count) * count) * 2;
    case 'rear':
    case 'aligned': {
      let cx = 0, maxY = -Infinity;
      for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; if (pts[i + 1] > maxY) maxY = pts[i + 1]; }
      cx /= count;
      if (ctx.mode === 'rear') {
        // Back-most point; among ties, the one nearest the middle.
        let best = 0, bestScore = Infinity;
        for (let i = 0; i < pts.length; i += 2) {
          const score = (maxY - pts[i + 1]) * 100 + Math.abs(pts[i] - cx);
          if (score < bestScore) { bestScore = score; best = i; }
        }
        return best;
      }
      // Aligned: stay close to the seam on the layer below (one tidy vertical line),
      // tucked into a corner where there is one nearby.
      // No seam within 10 mm below (first layer, or a new island): start at the back.
      let ref: Pt = { x: cx, y: maxY };
      let refD = 100;
      for (const q of ctx.previous) {
        const i = nearestVertex(p, q.x, q.y);
        const d = (pts[i] - q.x) ** 2 + (pts[i + 1] - q.y) ** 2;
        if (d < refD) { refD = d; ref = q; }
      }
      let best = 0, bestScore = Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        const d = Math.hypot(pts[i] - ref.x, pts[i + 1] - ref.y);
        const score = d - 3 * cornerSharpness(pts, i);
        if (score < bestScore) { bestScore = score; best = i; }
      }
      return best;
    }
  }
}

function rotateLoop(p: ToolPath, start: number): ToolPath {
  if (!p.closed || start === 0) return p;
  return { ...p, points: [...p.points.slice(start), ...p.points.slice(0, start)] };
}
