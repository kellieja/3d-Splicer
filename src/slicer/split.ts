import { ShapeUtils, Vector2 } from 'three';
import ClipperLib from 'clipper-lib';
import type { PrinterProfile, PrintSettings } from '../types';
import { computeBounds, type TriangleSoup } from './mesh';
import { sliceMesh } from './slice';
import { area, difference, intersection, offset, SCALE, splitIslands, type Path, type Paths } from './geometry';

/*
 * Splitting ("splicing") models that are too big for the printer.
 *
 *  1. The model is cut by axis-aligned planes into a grid of parts.
 *     Every cut face is closed with a flat cap, so each part is a solid.
 *  2. Where two parts meet, dowel joints are added: a pin on the lower part
 *     and a matching hole in the upper part (lower/upper along the cut axis).
 *  3. Each part is turned to lie on its best side (few overhangs, pins not
 *     pointing down) and the parts are packed onto as few plates as possible.
 */

export type Axis = 0 | 1 | 2;
export type Cuts = [number[], number[], number[]];

export interface DowelOptions {
  enabled: boolean;
  /** Pin diameter in mm. */
  diameter: number;
  /** Pin length in mm. The hole is 0.6 mm deeper. */
  length: number;
  /** Hole diameter minus pin diameter, in mm. */
  tolerance: number;
}

export interface SplitOptions {
  /** Cut positions per axis, measured from the model's minimum corner (mm). */
  cuts: Cuts;
  dowels: DowelOptions;
  autoOrient: boolean;
  printer: PrinterProfile;
  settings: PrintSettings;
}

export interface SplitPart {
  id: number;
  label: string;
  /** Grid cell (x, y, z index). */
  cell: [number, number, number];
  /** Final geometry (with pins/holes) in model coordinates. */
  positions: TriangleSoup;
  pins: number;
  holes: number;
  fits: boolean;
}

export interface PlacedPart {
  part: number;
  /** Part geometry turned and moved to its spot on the plate. */
  positions: TriangleSoup;
}

export interface Plate {
  parts: PlacedPart[];
}

export interface SplitResult {
  parts: SplitPart[];
  plates: Plate[];
  /** Absolute cut positions actually used. */
  cuts: Cuts;
  dowels: number;
  warnings: string[];
}

export const DEFAULT_DOWELS: DowelOptions = { enabled: true, diameter: 6, length: 8, tolerance: 0.3 };

const HOLE_EXTRA_DEPTH = 0.6;
const PIN_SEGMENTS = 32;
const WALL_MARGIN = 1.2;

// ─── Plate area ─────────────────────────────────────────────────────────

interface PlateArea {
  x0: number;
  y0: number;
  w: number;
  h: number;
  gap: number;
}

function plateArea(printer: PrinterProfile, s: PrintSettings): PlateArea {
  const adhesion = s.adhesion === 'brim' ? s.brimWidth : s.adhesion === 'skirt' ? s.skirtDistance + 2 : 0;
  const margin = 5 + adhesion;
  const gap = 5 + (s.adhesion === 'brim' ? 2 * s.brimWidth : 0);
  if (printer.bedShape === 'circle') {
    const side = printer.bedX / Math.SQRT2 - 2 * margin;
    const [cx, cy] = printer.originCenter ? [0, 0] : [printer.bedX / 2, printer.bedY / 2];
    return { x0: cx - side / 2, y0: cy - side / 2, w: side, h: side, gap };
  }
  const bx = printer.originCenter ? -printer.bedX / 2 : 0;
  const by = printer.originCenter ? -printer.bedY / 2 : 0;
  return { x0: bx + margin, y0: by + margin, w: printer.bedX - 2 * margin, h: printer.bedY - 2 * margin, gap };
}

/**
 * Fewest evenly spaced cuts so every part fits the printer (with room for pins).
 * Returned positions are relative to the model's minimum corner.
 */
export function autoCuts(size: [number, number, number], printer: PrinterProfile, s: PrintSettings, dowels: DowelOptions): Cuts {
  const a = plateArea(printer, s);
  const pin = dowels.enabled ? dowels.length : 0;
  const limits = [a.w - pin, a.h - pin, printer.maxZ - pin];
  return [0, 1, 2].map((i) => {
    const n = Math.max(1, Math.ceil(size[i] / Math.max(10, limits[i]) - 1e-6));
    return Array.from({ length: n - 1 }, (_, k) => +(((k + 1) * size[i]) / n).toFixed(2));
  }) as Cuts;
}

// ─── Coordinates on a cut plane ─────────────────────────────────────────
// For a plane perpendicular to axis a we use cyclic coordinates (u, v, w)
// with w along a. Cyclic permutations keep triangle winding intact.

function toUVW(a: Axis, x: number, y: number, z: number): [number, number, number] {
  return a === 0 ? [y, z, x] : a === 1 ? [z, x, y] : [x, y, z];
}

function fromUVW(a: Axis, u: number, v: number, w: number): [number, number, number] {
  return a === 0 ? [w, u, v] : a === 1 ? [v, w, u] : [u, v, w];
}

function permute(soup: ArrayLike<number>, a: Axis): Float32Array {
  const out = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    const [u, v, w] = toUVW(a, soup[i], soup[i + 1], soup[i + 2]);
    out[i] = u;
    out[i + 1] = v;
    out[i + 2] = w;
  }
  return out;
}

/** Which of the plane's (u, v) coordinates runs along the `other` axis. */
function uvIndexOf(planeAxis: Axis, other: Axis): 0 | 1 {
  // toUVW(axis, 0, 1, 2) lists the source axis for u, v and w.
  return toUVW(planeAxis, 0, 1, 2)[0] === other ? 0 : 1;
}

// ─── Parts under construction ───────────────────────────────────────────

interface Cap {
  axis: Axis;
  value: number;
  /** +1: cap faces +axis (solid is below the plane). -1: faces -axis. */
  side: 1 | -1;
  /** Cross-section in plane (u, v) coordinates, Clipper units. */
  region: Paths;
}

interface Joint {
  axis: Axis;
  value: number;
  /** Centre in plane (u, v) coordinates, mm. */
  u: number;
  v: number;
}

interface WorkPart {
  body: number[];
  caps: Cap[];
  cell: [number, number, number];
  pins: Joint[];
  holes: Joint[];
}

function pushTri(out: number[], p0: number[], p1: number[], p2: number[], normal?: number[]) {
  if (normal) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * normal[0] + ny * normal[1] + nz * normal[2] < 0) [p1, p2] = [p2, p1];
  }
  out.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
}

/** Splits body triangles by the plane coord[a] = value. */
function splitBody(body: number[], a: Axis, value: number): { below: number[]; above: number[] } {
  const below: number[] = [];
  const above: number[] = [];
  const p = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const cross = (i: number, j: number) => {
    // Interpolate from the lower vertex so both neighbours compute identical points.
    const [lo, hi] = p[i][a] < p[j][a] ? [p[i], p[j]] : [p[j], p[i]];
    const t = (value - lo[a]) / (hi[a] - lo[a]);
    return [lo[0] + (hi[0] - lo[0]) * t, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t];
  };
  for (let t = 0; t < body.length; t += 9) {
    for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) p[k][c] = body[t + k * 3 + c];
    // Same rule as the slicer: a vertex exactly on the plane counts as above.
    const isAbove = p.map((q) => q[a] >= value);
    const n = isAbove.filter(Boolean).length;
    if (n === 3) { for (let k = 0; k < 9; k++) above.push(body[t + k]); continue; }
    if (n === 0) { for (let k = 0; k < 9; k++) below.push(body[t + k]); continue; }
    // One vertex is alone on its side: rotate so it's p[i0], keeping winding.
    const lone = n === 1 ? isAbove.indexOf(true) : isAbove.indexOf(false);
    const i0 = lone, i1 = (lone + 1) % 3, i2 = (lone + 2) % 3;
    const a1 = cross(i0, i1), a2 = cross(i0, i2);
    const loneSide = n === 1 ? above : below;
    const pairSide = n === 1 ? below : above;
    pushTri(loneSide, p[i0], a1, a2);
    pushTri(pairSide, a1, p[i1], p[i2]);
    pushTri(pairSide, a1, p[i2], a2);
  }
  return { below, above };
}

/** Triangulates a planar region into 3D triangles facing `side` along axis a. */
function triangulateRegion(region: Paths, a: Axis, w: number, side: 1 | -1, out: number[]) {
  const normal = fromUVW(a, 0, 0, side);
  for (const island of splitIslands(region)) {
    const contour = island.outer.map((p) => new Vector2(p.X / SCALE, p.Y / SCALE));
    const holes = island.holes.map((h) => h.map((p) => new Vector2(p.X / SCALE, p.Y / SCALE)));
    const faces = ShapeUtils.triangulateShape(contour, holes);
    const all = contour.concat(...holes);
    for (const [i, j, k] of faces) {
      pushTri(
        out,
        fromUVW(a, all[i].x, all[i].y, w),
        fromUVW(a, all[j].x, all[j].y, w),
        fromUVW(a, all[k].x, all[k].y, w),
        normal,
      );
    }
  }
}

function materialize(part: WorkPart): Float32Array {
  const out = part.body.slice();
  for (const c of part.caps) triangulateRegion(c.region, c.axis, c.value, c.side, out);
  return new Float32Array(out);
}

function crossSection(soup: Float32Array, a: Axis, value: number): Paths {
  return sliceMesh(permute(soup, a), [value])[0];
}

const BIG = 1e9;

function halfPlane(uvIndex: 0 | 1, value: number, keepBelow: boolean): Paths {
  const c = Math.round(value * SCALE);
  const [lo, hi] = keepBelow ? [-BIG, c] : [c, BIG];
  const rect = uvIndex === 0
    ? [{ X: lo, Y: -BIG }, { X: hi, Y: -BIG }, { X: hi, Y: BIG }, { X: lo, Y: BIG }]
    : [{ X: -BIG, Y: lo }, { X: BIG, Y: lo }, { X: BIG, Y: hi }, { X: -BIG, Y: hi }];
  return [rect];
}

function extent(body: number[], a: Axis): [number, number] {
  let min = Infinity, max = -Infinity;
  for (let i = a; i < body.length; i += 3) {
    if (body[i] < min) min = body[i];
    if (body[i] > max) max = body[i];
  }
  return [min, max];
}

function cutPart(part: WorkPart, a: Axis, value: number): WorkPart[] {
  const [min, max] = extent(part.body, a);
  if (!(min < value && max > value)) {
    // The plane misses this part; it just moves to the right grid cell.
    if (min >= value) part.cell[a]++;
    return [part];
  }
  const section = crossSection(materialize(part), a, value);
  const { below, above } = splitBody(part.body, a, value);
  const lo: WorkPart = { body: below, caps: [], cell: [...part.cell], pins: [], holes: [] };
  const hi: WorkPart = { body: above, caps: [], cell: [...part.cell], pins: [], holes: [] };
  hi.cell[a]++;
  for (const cap of part.caps) {
    if (cap.axis === a) {
      (cap.value < value ? lo : hi).caps.push(cap);
      continue;
    }
    const uvi = uvIndexOf(cap.axis, a);
    const rl = intersection(cap.region, halfPlane(uvi, value, true));
    const rh = intersection(cap.region, halfPlane(uvi, value, false));
    if (rl.length) lo.caps.push({ ...cap, region: rl });
    if (rh.length) hi.caps.push({ ...cap, region: rh });
  }
  if (section.length) {
    lo.caps.push({ axis: a, value, side: 1, region: section });
    hi.caps.push({ axis: a, value, side: -1, region: section });
  }
  return [lo, hi].filter((p) => p.body.length > 0);
}

// ─── Dowels ─────────────────────────────────────────────────────────────

function circle(u: number, v: number, r: number, segments = PIN_SEGMENTS): Path {
  const pts: Path = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push({ X: Math.round((u + Math.cos(t) * r) * SCALE), Y: Math.round((v + Math.sin(t) * r) * SCALE) });
  }
  return pts;
}

function insideRegion(region: Paths, u: number, v: number, r: number): boolean {
  const c = [circle(u, v, r, 16)];
  return area(difference(c, region)) < 0.01;
}

function pointInIslands(p: { X: number; Y: number }, region: Paths): boolean {
  let inside = false;
  for (const path of region) if (ClipperLib.Clipper.PointInPolygon(p, path) !== 0) inside = !inside;
  return inside;
}

/**
 * Candidate dowel layouts for each island of the joint face, best first:
 * pairs far apart (stops twisting), pulled further inwards each time, then
 * a single central dowel.
 */
function dowelCandidates(face: Paths, rHole: number, diameter: number): [number, number][][][] {
  const inset = offset(face, -(rHole + WALL_MARGIN));
  const islands: [number, number][][][] = [];
  for (const island of splitIslands(inset)) {
    const pts = island.outer;
    if (pts.length === 0) continue;
    const islandRegion = [island.outer, ...island.holes];
    const inside = (p: { X: number; Y: number }) => pointInIslands(p, islandRegion);
    const mm = (p: { X: number; Y: number }): [number, number] => [p.X / SCALE, p.Y / SCALE];
    const step = Math.max(1, Math.floor(pts.length / 150));
    let best = 0, bi = 0, bj = 0;
    for (let i = 0; i < pts.length; i += step)
      for (let j = i + step; j < pts.length; j += step) {
        const d = (pts[i].X - pts[j].X) ** 2 + (pts[i].Y - pts[j].Y) ** 2;
        if (d > best) { best = d; bi = i; bj = j; }
      }
    const p = pts[bi], q = pts[bj];
    const lerp = (a: typeof p, b: typeof p, t: number) => ({ X: Math.round(a.X + (b.X - a.X) * t), Y: Math.round(a.Y + (b.Y - a.Y) * t) });
    const layouts: [number, number][][] = [];
    for (const t of [0.15, 0.3, 0.4]) {
      const a = lerp(p, q, t), b = lerp(q, p, t);
      const apart = Math.hypot(a.X - b.X, a.Y - b.Y) / SCALE;
      if (apart >= 2 * diameter + 4 && inside(a) && inside(b)) layouts.push([mm(a), mm(b)]);
    }
    let cx = 0, cy = 0;
    for (const pt of pts) { cx += pt.X; cy += pt.Y; }
    const c = { X: Math.round(cx / pts.length), Y: Math.round(cy / pts.length) };
    const mid = lerp(p, q, 0.5);
    for (const single of [c, mid, pts[0]]) if (inside(single) || single === pts[0]) layouts.push([mm(single)]);
    islands.push(layouts);
  }
  return islands;
}

/** Adds cylinder walls between rings; `outward` = pin (normals away from axis). */
function cylinder(out: number[], a: Axis, u: number, v: number, rings: [number, number][], outward: boolean) {
  const ring = (r: number, w: number) =>
    circle(u, v, r).map((p) => fromUVW(a, p.X / SCALE, p.Y / SCALE, w));
  for (let k = 0; k < rings.length - 1; k++) {
    const [r0, w0] = rings[k], [r1, w1] = rings[k + 1];
    const A = ring(r0, w0), B = ring(r1, w1);
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      const t = ((i + 0.5) / A.length) * Math.PI * 2;
      const radial = fromUVW(a, Math.cos(t), Math.sin(t), 0).map((c) => (outward ? c : -c));
      pushTri(out, A[i], A[j], B[j], radial);
      pushTri(out, A[i], B[j], B[i], radial);
    }
  }
}

function disc(out: number[], a: Axis, u: number, v: number, r: number, w: number, side: 1 | -1) {
  const pts = circle(u, v, r).map((p) => fromUVW(a, p.X / SCALE, p.Y / SCALE, w));
  const c = fromUVW(a, u, v, w);
  const normal = fromUVW(a, 0, 0, side);
  for (let i = 0; i < pts.length; i++) pushTri(out, c, pts[i], pts[(i + 1) % pts.length], normal);
}

function finalGeometry(part: WorkPart, d: DowelOptions): Float32Array {
  const out = part.body.slice();
  const rPin = d.diameter / 2;
  const rHole = rPin + d.tolerance / 2;
  for (const cap of part.caps) {
    const here = (j: Joint) => j.axis === cap.axis && Math.abs(j.value - cap.value) < 1e-6;
    const pins = cap.side === 1 ? part.pins.filter(here) : [];
    const holes = cap.side === -1 ? part.holes.filter(here) : [];
    const cutouts = [...pins.map((j) => circle(j.u, j.v, rPin)), ...holes.map((j) => circle(j.u, j.v, rHole))];
    const region = cutouts.length ? difference(cap.region, cutouts) : cap.region;
    triangulateRegion(region, cap.axis, cap.value, cap.side, out);
    for (const j of pins) {
      // Pin sticks out of the +axis face, with a small chamfer at the tip.
      const w = cap.value;
      const chamfer = Math.min(0.6, d.length / 4);
      cylinder(out, cap.axis, j.u, j.v, [[rPin, w], [rPin, w + d.length - chamfer], [rPin - chamfer * 0.7, w + d.length]], true);
      disc(out, cap.axis, j.u, j.v, rPin - chamfer * 0.7, w + d.length, 1);
    }
    for (const j of holes) {
      // Hole goes into the part, which lies above the -axis face.
      const depth = d.length + HOLE_EXTRA_DEPTH;
      cylinder(out, cap.axis, j.u, j.v, [[rHole, cap.value], [rHole, cap.value + depth]], false);
      disc(out, cap.axis, j.u, j.v, rHole, cap.value + depth, -1);
    }
  }
  return new Float32Array(out);
}

function addDowels(parts: WorkPart[], d: DowelOptions, warnings: string[], labelOf: (p: WorkPart) => string): number {
  if (!d.enabled) return 0;
  const rHole = d.diameter / 2 + d.tolerance / 2;
  const depth = d.length + HOLE_EXTRA_DEPTH;
  let count = 0;
  const key = (c: number[]) => c.join(',');
  const byCell = new Map(parts.map((p) => [key(p.cell), p]));
  const solids = new Map<WorkPart, Float32Array>();
  const solid = (p: WorkPart) => {
    let s = solids.get(p);
    if (!s) { s = materialize(p); solids.set(p, s); }
    return s;
  };

  for (const lower of parts) {
    for (const cap of lower.caps) {
      if (cap.side !== 1) continue;
      const cell = [...lower.cell];
      cell[cap.axis]++;
      const upper = byCell.get(key(cell));
      const other = upper?.caps.find((c) => c.axis === cap.axis && c.side === -1 && Math.abs(c.value - cap.value) < 1e-6);
      if (!upper || !other) continue;
      const face = intersection(cap.region, other.region);
      if (area(face) < 1) continue;

      // The hole needs solid material around it all the way down.
      const checks = [0.3, 0.65, 1].map((f) => crossSection(solid(upper), cap.axis, cap.value + depth * f + 0.3));
      const valid = ([u, v]: [number, number]) => checks.every((sec) => insideRegion(sec, u, v, rHole + 0.8));
      // Per island, use the first layout whose holes all have enough material around them.
      const ok = dowelCandidates(face, rHole, d.diameter).flatMap((layouts) => layouts.find((l) => l.every(valid)) ?? []);
      if (ok.length === 0) {
        warnings.push(`The joint between ${labelOf(lower)} and ${labelOf(upper)} is too small or thin for dowels: glue it instead.`);
        continue;
      }
      for (const [u, v] of ok) {
        const j: Joint = { axis: cap.axis, value: cap.value, u, v };
        lower.pins.push(j);
        upper.holes.push(j);
        count++;
      }
    }
  }
  return count;
}

// ─── Orientation ────────────────────────────────────────────────────────

type Rot = (x: number, y: number, z: number) => [number, number, number];

/** Rotations that put each of the six sides down, starting with "as is". */
const ROTATIONS: { name: string; f: Rot }[] = [
  { name: 'as is', f: (x, y, z) => [x, y, z] },
  { name: 'upside down', f: (x, y, z) => [x, -y, -z] },
  { name: '+X down', f: (x, y, z) => [z, y, -x] },
  { name: '-X down', f: (x, y, z) => [-z, y, x] },
  { name: '+Y down', f: (x, y, z) => [x, z, -y] },
  { name: '-Y down', f: (x, y, z) => [x, -z, y] },
];

function rotateSoup(soup: Float32Array, f: Rot): Float32Array {
  const out = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    const [x, y, z] = f(soup[i], soup[i + 1], soup[i + 2]);
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
  return out;
}

function orientationScore(soup: Float32Array, pinDirs: number[][], f: Rot, s: PrintSettings, d: DowelOptions): number {
  const minZ = computeBounds(soup).min[2];
  const limit = -Math.sin((Math.min(89, Math.max(1, s.supportAngle)) * Math.PI) / 180);
  let overhang = 0, contact = 0;
  for (let i = 0; i < soup.length; i += 9) {
    const ux = soup[i + 3] - soup[i], uy = soup[i + 4] - soup[i + 1], uz = soup[i + 5] - soup[i + 2];
    const vx = soup[i + 6] - soup[i], vy = soup[i + 7] - soup[i + 1], vz = soup[i + 8] - soup[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) continue;
    const a = len / 2, cz = nz / len;
    const top = Math.max(soup[i + 2], soup[i + 5], soup[i + 8]);
    if (top < minZ + 0.05 && cz < -0.99) contact += a;
    else if (cz < limit) overhang += a * -cz;
  }
  let pins = 0;
  for (const dir of pinDirs) {
    const dz = f(dir[0], dir[1], dir[2])[2];
    if (dz < -0.5) pins += 1e9; // a pin pointing into the bed can't be printed
    else if (dz < 0.5) pins += d.diameter * d.length; // sideways pins need a little support
  }
  return overhang + pins - contact * 0.05;
}

// ─── Packing ────────────────────────────────────────────────────────────

interface Shelf { y: number; h: number; x: number }
interface PackPlate { shelves: Shelf[]; usedH: number; items: { part: number; x: number; y: number; turn: boolean }[] }

function pack(sizes: { part: number; w: number; h: number }[], area: PlateArea): PackPlate[] {
  const plates: PackPlate[] = [];
  const g = area.gap;
  const tryPlace = (p: PackPlate, part: number, w: number, h: number, turn: boolean): boolean => {
    for (const sh of p.shelves) {
      if (sh.x + w <= area.w + 1e-6 && h <= sh.h + 1e-6) {
        p.items.push({ part, x: sh.x, y: sh.y, turn });
        sh.x += w + g;
        return true;
      }
    }
    if (p.usedH + h <= area.h + 1e-6 && w <= area.w + 1e-6) {
      p.shelves.push({ y: p.usedH, h, x: w + g });
      p.items.push({ part, x: 0, y: p.usedH, turn });
      p.usedH += h + g;
      return true;
    }
    return false;
  };
  // Tallest first, lying with the long side along X.
  const items = sizes
    .map((s) => (s.h > s.w ? { part: s.part, w: s.h, h: s.w, turned: true } : { part: s.part, w: s.w, h: s.h, turned: false }))
    .sort((a, b) => b.h - a.h || b.w - a.w);
  for (const it of items) {
    let placed = false;
    for (const p of plates) {
      if (tryPlace(p, it.part, it.w, it.h, it.turned) || tryPlace(p, it.part, it.h, it.w, !it.turned)) { placed = true; break; }
    }
    if (!placed) {
      const p: PackPlate = { shelves: [], usedH: 0, items: [] };
      plates.push(p);
      if (!tryPlace(p, it.part, it.w, it.h, it.turned) && !tryPlace(p, it.part, it.h, it.w, !it.turned)) {
        // Too big even for an empty plate: put it alone at the corner anyway.
        p.items.push({ part: it.part, x: 0, y: 0, turn: it.turned });
        p.usedH = area.h;
      }
    }
  }
  return plates;
}

// ─── Main entry ─────────────────────────────────────────────────────────

/**
 * Cuts a placed model into parts, adds dowels, orients each part and packs
 * the parts onto plates. `positions` is the model as placed on the bed.
 */
export function splitModel(positions: TriangleSoup, opts: SplitOptions): SplitResult {
  const { printer, settings: s, dowels: d } = opts;
  const warnings: string[] = [];
  const b = computeBounds(positions);
  const cuts = opts.cuts.map((list, a) =>
    [...new Set(list)]
      .filter((c) => c > 0.5 && c < b.max[a] - b.min[a] - 0.5)
      .sort((x, y) => x - y)
      .map((c) => b.min[a] + c),
  ) as Cuts;

  let work: WorkPart[] = [{ body: Array.from(positions), caps: [], cell: [0, 0, 0], pins: [], holes: [] }];
  for (const a of [0, 1, 2] as Axis[]) {
    for (const value of cuts[a]) work = work.flatMap((p) => cutPart(p, a, value));
  }
  work.sort((p, q) => p.cell[2] - q.cell[2] || p.cell[1] - q.cell[1] || p.cell[0] - q.cell[0]);
  const labelOf = (p: WorkPart) => `part ${work.indexOf(p) + 1}`;
  const dowels = addDowels(work, d, warnings, labelOf);

  const area = plateArea(printer, s);
  const fitsBed = (w: number, h: number) => (w <= area.w && h <= area.h) || (h <= area.w && w <= area.h);

  const parts: SplitPart[] = [];
  const oriented: Float32Array[] = [];
  work.forEach((p, i) => {
    const geom = finalGeometry(p, d);
    const pinDirs = p.pins.map((j) => fromUVW(j.axis, 0, 0, 1));
    const choices = (opts.autoOrient ? ROTATIONS : ROTATIONS.slice(0, 1)).map((r) => {
      const soup = rotateSoup(geom, r.f);
      const [w, h, z] = sizeOf(soup);
      const fits = fitsBed(w, h) && z <= printer.maxZ;
      return { soup, fits, score: orientationScore(soup, pinDirs, r.f, s, d) + (fits ? 0 : 1e12) };
    });
    const best = choices.reduce((m, c) => (c.score < m.score - 1e-3 ? c : m), choices[0]);
    parts.push({ id: i, label: `Part ${i + 1}`, cell: p.cell, positions: geom, pins: p.pins.length, holes: p.holes.length, fits: best.fits });
    oriented.push(best.soup);
    if (!best.fits) warnings.push(`Part ${i + 1} is still too big for this printer: add more cuts.`);
  });

  const sizes = oriented.map((soup, part) => {
    const [w, h] = sizeOf(soup);
    return { part, w, h };
  });
  const plates: Plate[] = pack(sizes, area).map((pp) => {
    const placed = pp.items.map((it) => {
      let soup = oriented[it.part];
      if (it.turn) soup = rotateSoup(soup, (x, y, z) => [-y, x, z]);
      const bb = computeBounds(soup);
      const out = new Float32Array(soup.length);
      for (let k = 0; k < soup.length; k += 3) {
        out[k] = soup[k] - bb.min[0] + area.x0 + it.x;
        out[k + 1] = soup[k + 1] - bb.min[1] + area.y0 + it.y;
        out[k + 2] = soup[k + 2] - bb.min[2];
      }
      return { part: it.part, positions: out };
    });
    centrePlate(placed, area);
    return { parts: placed };
  });

  return { parts, plates, cuts, dowels, warnings };
}

function sizeOf(soup: Float32Array): [number, number, number] {
  const bb = computeBounds(soup);
  return [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
}

function centrePlate(parts: PlacedPart[], area: PlateArea) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of parts) {
    const bb = computeBounds(p.positions);
    minX = Math.min(minX, bb.min[0]); minY = Math.min(minY, bb.min[1]);
    maxX = Math.max(maxX, bb.max[0]); maxY = Math.max(maxY, bb.max[1]);
  }
  const dx = area.x0 + area.w / 2 - (minX + maxX) / 2;
  const dy = area.y0 + area.h / 2 - (minY + maxY) / 2;
  for (const p of parts)
    for (let k = 0; k < p.positions.length; k += 3) {
      p.positions[k] += dx;
      p.positions[k + 1] += dy;
    }
}

/** All parts of a plate as one triangle soup, ready for the slicer. */
export function plateSoup(plate: Plate): Float32Array {
  const total = plate.parts.reduce((n, p) => n + p.positions.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of plate.parts) { out.set(p.positions, o); o += p.positions.length; }
  return out;
}

/** Signed volume of a closed mesh in mm³ (negative if normals point inwards). */
export function meshVolume(soup: ArrayLike<number>): number {
  let v = 0;
  for (let i = 0; i < soup.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.prototype.slice.call(soup, i, i + 9) as number[];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}
