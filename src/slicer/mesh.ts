import type { Bounds, ModelTransform, PrinterProfile } from '../types';

/**
 * Meshes are plain "triangle soups": a Float32Array with 9 numbers
 * (3 vertices × x,y,z) per triangle, Z pointing up, units in mm.
 */
export type TriangleSoup = Float32Array;

export const IDENTITY_TRANSFORM: ModelTransform = {
  scale: [1, 1, 1],
  rotation: [0, 0, 0],
  offset: [0, 0],
};

export function computeBounds(positions: TriangleSoup): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  if (positions.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

export function boundsSize(b: Bounds): [number, number, number] {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

/** Row-major 3×3 rotation matrix for X, then Y, then Z rotations (degrees). */
function rotationMatrix([rx, ry, rz]: [number, number, number]): number[] {
  const d = Math.PI / 180;
  const [cx, sx] = [Math.cos(rx * d), Math.sin(rx * d)];
  const [cy, sy] = [Math.cos(ry * d), Math.sin(ry * d)];
  const [cz, sz] = [Math.cos(rz * d), Math.sin(rz * d)];
  // R = Rz * Ry * Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

/** Centre of the bed in printer coordinates. */
export function bedCenter(printer: PrinterProfile): [number, number] {
  return printer.originCenter ? [0, 0] : [printer.bedX / 2, printer.bedY / 2];
}

/**
 * Scales and rotates the model around its own centre, then places it on the
 * bed: centred (plus the user offset) and resting on Z = 0.
 */
export function placeOnBed(
  source: TriangleSoup,
  transform: ModelTransform,
  printer: PrinterProfile,
): TriangleSoup {
  const out = new Float32Array(source.length);
  const src = computeBounds(source);
  const c = [0, 1, 2].map((a) => (src.min[a] + src.max[a]) / 2);
  const m = rotationMatrix(transform.rotation);
  const [sx, sy, sz] = transform.scale;

  for (let i = 0; i < source.length; i += 3) {
    const x = (source[i] - c[0]) * sx;
    const y = (source[i + 1] - c[1]) * sy;
    const z = (source[i + 2] - c[2]) * sz;
    out[i] = m[0] * x + m[1] * y + m[2] * z;
    out[i + 1] = m[3] * x + m[4] * y + m[5] * z;
    out[i + 2] = m[6] * x + m[7] * y + m[8] * z;
  }

  // Negative scale factors mirror the model, which flips triangle winding.
  if (sx * sy * sz < 0) {
    for (let i = 0; i < out.length; i += 9) {
      for (let a = 0; a < 3; a++) {
        const t = out[i + 3 + a];
        out[i + 3 + a] = out[i + 6 + a];
        out[i + 6 + a] = t;
      }
    }
  }

  const b = computeBounds(out);
  const [bx, by] = bedCenter(printer);
  const dx = bx + transform.offset[0] - (b.min[0] + b.max[0]) / 2;
  const dy = by + transform.offset[1] - (b.min[1] + b.max[1]) / 2;
  const dz = -b.min[2];
  for (let i = 0; i < out.length; i += 3) {
    out[i] += dx;
    out[i + 1] += dy;
    out[i + 2] += dz;
  }
  return out;
}

/** Returns a list of problems if the placed model doesn't fit the printer. */
export function checkFits(bounds: Bounds, printer: PrinterProfile): string[] {
  const problems: string[] = [];
  const eps = 0.01;
  if (printer.bedShape === 'circle') {
    const r = printer.bedX / 2;
    const [cx, cy] = bedCenter(printer);
    const corners = [
      [bounds.min[0], bounds.min[1]],
      [bounds.min[0], bounds.max[1]],
      [bounds.max[0], bounds.min[1]],
      [bounds.max[0], bounds.max[1]],
    ];
    // Bounding-box corners are a conservative check for round beds.
    const far = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
    if (far > r + eps) problems.push(`The model reaches ${far.toFixed(1)} mm from the centre, but the bed radius is ${r} mm.`);
  } else {
    const [x0, y0] = printer.originCenter ? [-printer.bedX / 2, -printer.bedY / 2] : [0, 0];
    if (bounds.min[0] < x0 - eps || bounds.max[0] > x0 + printer.bedX + eps)
      problems.push(`The model is wider than the bed (X ${printer.bedX} mm).`);
    if (bounds.min[1] < y0 - eps || bounds.max[1] > y0 + printer.bedY + eps)
      problems.push(`The model is deeper than the bed (Y ${printer.bedY} mm).`);
  }
  if (bounds.max[2] > printer.maxZ + eps)
    problems.push(`The model is taller than the printer's maximum height (${printer.maxZ} mm).`);
  return problems;
}

/** Largest uniform scale factor that still fits the build volume. */
export function fitScale(size: [number, number, number], printer: PrinterProfile, margin = 10): number {
  const usableX = printer.bedX - margin * 2;
  const usableY = printer.bedY - margin * 2;
  let limit: number;
  if (printer.bedShape === 'circle') {
    const diag = Math.hypot(size[0], size[1]);
    limit = diag > 0 ? usableX / diag : Infinity;
  } else {
    limit = Math.min(size[0] > 0 ? usableX / size[0] : Infinity, size[1] > 0 ? usableY / size[1] : Infinity);
  }
  if (size[2] > 0) limit = Math.min(limit, printer.maxZ / size[2]);
  return Number.isFinite(limit) ? limit : 1;
}

/** A 20 mm calibration cube, handy for trying the slicer without a file. */
export function makeCube(size = 20): TriangleSoup {
  const s = size;
  const v = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
  ];
  // Counter-clockwise when viewed from outside.
  const faces = [
    [0, 2, 1], [0, 3, 2], // bottom
    [4, 5, 6], [4, 6, 7], // top
    [0, 1, 5], [0, 5, 4], // front
    [1, 2, 6], [1, 6, 5], // right
    [2, 3, 7], [2, 7, 6], // back
    [3, 0, 4], [3, 4, 7], // left
  ];
  const out = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => f.forEach((vi, j) => out.set(v[vi], i * 9 + j * 3)));
  return out;
}

/** A cylinder with a cone on top: a sample with curves and overhang-free slopes. */
export function makeSampleTower(radius = 12, height = 30, segments = 64): TriangleSoup {
  const tris: number[] = [];
  const coneH = radius;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0 = [Math.cos(a0) * radius, Math.sin(a0) * radius];
    const p1 = [Math.cos(a1) * radius, Math.sin(a1) * radius];
    // bottom (facing down)
    tris.push(0, 0, 0, p1[0], p1[1], 0, p0[0], p0[1], 0);
    // side
    tris.push(p0[0], p0[1], 0, p1[0], p1[1], 0, p1[0], p1[1], height);
    tris.push(p0[0], p0[1], 0, p1[0], p1[1], height, p0[0], p0[1], height);
    // cone
    tris.push(p0[0], p0[1], height, p1[0], p1[1], height, 0, 0, height + coneH);
  }
  return new Float32Array(tris);
}
