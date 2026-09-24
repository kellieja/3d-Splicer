import type { TriangleSoup } from '../slicer/mesh';
import { computeBounds } from '../slicer/mesh';

/** Encodes a triangle soup as a binary STL file, moved so it sits at the origin. */
export function toBinaryStl(soup: TriangleSoup, name = 'part'): Uint8Array {
  const count = soup.length / 9;
  const buf = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buf);
  const header = `3D Splicer: ${name}`.slice(0, 80);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);
  view.setUint32(80, count, true);
  const b = computeBounds(soup);
  const [ox, oy, oz] = [b.min[0], b.min[1], b.min[2]];
  let o = 84;
  for (let t = 0; t < soup.length; t += 9) {
    const ax = soup[t] - ox, ay = soup[t + 1] - oy, az = soup[t + 2] - oz;
    const bx = soup[t + 3] - ox, by = soup[t + 4] - oy, bz = soup[t + 5] - oz;
    const cx = soup[t + 6] - ox, cy = soup[t + 7] - oy, cz = soup[t + 8] - oz;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
      view.setFloat32(o, v, true);
      o += 4;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}
