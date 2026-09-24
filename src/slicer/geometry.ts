import ClipperLib from 'clipper-lib';

/**
 * Thin helpers around Clipper (polygon boolean operations and offsetting).
 * Clipper works in integers, so millimetres are scaled by SCALE (1 unit = 1 µm).
 */
export const SCALE = 1000;

export type Point = { X: number; Y: number };
export type Path = Point[];
export type Paths = Path[];

const { Clipper, ClipperOffset, ClipType, PolyType, PolyFillType, JoinType, EndType } = ClipperLib;

export function toClipper(mm: number): number {
  return Math.round(mm * SCALE);
}

function boolean(type: ClipperLib.ClipType, subject: Paths, clip: Paths, subjectFill = PolyFillType.pftNonZero): Paths {
  if (subject.length === 0) return type === ClipType.ctUnion ? union(clip) : [];
  const c = new Clipper();
  c.AddPaths(subject, PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(type, out, subjectFill, PolyFillType.pftNonZero);
  return out;
}

export function union(a: Paths, b: Paths = [], fill = PolyFillType.pftNonZero): Paths {
  if (a.length === 0 && b.length === 0) return [];
  const c = new Clipper();
  c.AddPaths(a, PolyType.ptSubject, true);
  if (b.length) c.AddPaths(b, PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(ClipType.ctUnion, out, fill, fill);
  return out;
}

export function difference(a: Paths, b: Paths): Paths {
  if (a.length === 0) return [];
  if (b.length === 0) return a;
  return boolean(ClipType.ctDifference, a, b);
}

export function intersection(a: Paths, b: Paths): Paths {
  if (a.length === 0 || b.length === 0) return [];
  return boolean(ClipType.ctIntersection, a, b);
}

/** Grows (delta > 0) or shrinks (delta < 0) a region. Delta is in mm. */
export function offset(paths: Paths, deltaMm: number, round = false): Paths {
  if (paths.length === 0) return [];
  if (deltaMm === 0) return paths;
  const co = new ClipperOffset(2, 0.01 * SCALE);
  co.AddPaths(paths, round ? JoinType.jtRound : JoinType.jtMiter, EndType.etClosedPolygon);
  const out: Paths = [];
  co.Execute(out, deltaMm * SCALE);
  return out;
}

/** Removes slivers thinner than `widthMm` (morphological opening). */
export function open(paths: Paths, widthMm: number): Paths {
  return offset(offset(paths, -widthMm / 2), widthMm / 2);
}

/** Intersects open polylines with a closed region. Returns the pieces inside. */
export function clipLines(lines: Paths, region: Paths): Paths {
  if (lines.length === 0 || region.length === 0) return [];
  const c = new Clipper();
  c.AddPaths(lines, PolyType.ptSubject, false);
  c.AddPaths(region, PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipType.ctIntersection, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return Clipper.OpenPathsFromPolyTree(tree);
}

export function area(paths: Paths): number {
  let a = 0;
  for (const p of paths) a += Clipper.Area(p);
  return a / (SCALE * SCALE);
}

export function cleanAndSimplify(paths: Paths, toleranceMm = 0.01): Paths {
  const cleaned = Clipper.CleanPolygons(paths, toleranceMm * SCALE);
  return Clipper.SimplifyPolygons(cleaned, PolyFillType.pftNonZero).filter((p) => p.length >= 3);
}

export interface Island {
  outer: Path;
  holes: Paths;
}

/** Splits a region into separate islands (each outline with its holes). */
export function splitIslands(paths: Paths): Island[] {
  if (paths.length === 0) return [];
  const c = new Clipper();
  c.AddPaths(paths, PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipType.ctUnion, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return ClipperLib.JS.PolyTreeToExPolygons(tree).map((e) => ({ outer: e.outer, holes: e.holes }));
}

export function islandPaths(island: Island): Paths {
  return [island.outer, ...island.holes];
}

export function bounds(paths: Paths): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths)
    for (const pt of p) {
      if (pt.X < minX) minX = pt.X;
      if (pt.Y < minY) minY = pt.Y;
      if (pt.X > maxX) maxX = pt.X;
      if (pt.Y > maxY) maxY = pt.Y;
    }
  return { minX, minY, maxX, maxY };
}
