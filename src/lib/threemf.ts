import { strToU8, zipSync } from 'fflate';
import type { TriangleSoup } from '../slicer/mesh';
import { computeBounds } from '../slicer/mesh';

/*
 * Writer for standard (core-spec) 3MF files. Every slicer reads these:
 * Bambu Studio, OrcaSlicer, PrusaSlicer, Cura, Creality Print, ...
 * Each object keeps its own name and is placed with a build transform,
 * which is how slicers expect positioned objects.
 */

export interface ThreeMfObject {
  name: string;
  /** Triangle soup in printer/bed coordinates (mm). */
  positions: TriangleSoup;
}

export interface ThreeMfOptions {
  title?: string;
  /** Extra files to put in the package, e.g. Metadata/notes.txt. */
  extras?: Record<string, string>;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (n: number) => {
  const r = Math.round(n * 1e5) / 1e5;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Builds the <object> mesh with shared vertices, relative to the object's own origin. */
function meshXml(id: number, obj: ThreeMfObject, origin: [number, number, number]): string {
  const index = new Map<string, number>();
  const verts: string[] = [];
  const tris: string[] = [];
  const p = obj.positions;
  const vid = (i: number) => {
    const x = num(p[i] - origin[0]), y = num(p[i + 1] - origin[1]), z = num(p[i + 2] - origin[2]);
    const k = `${x} ${y} ${z}`;
    let v = index.get(k);
    if (v === undefined) {
      v = verts.length;
      index.set(k, v);
      verts.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
    }
    return v;
  };
  for (let t = 0; t < p.length; t += 9) {
    const a = vid(t), b = vid(t + 3), c = vid(t + 6);
    // Drop triangles that collapse to a line or point after rounding.
    if (a === b || b === c || a === c) continue;
    tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  return (
    `<object id="${id}" name="${escapeXml(obj.name)}" type="model"><mesh><vertices>` +
    verts.join('') +
    `</vertices><triangles>` +
    tris.join('') +
    `</triangles></mesh></object>`
  );
}

export function build3mf(objects: ThreeMfObject[], opts: ThreeMfOptions = {}): Uint8Array {
  const resources: string[] = [];
  const items: string[] = [];
  objects.forEach((obj, i) => {
    const id = i + 1;
    const b = computeBounds(obj.positions);
    // Object origin: centre of its footprint, on its lowest point.
    const origin: [number, number, number] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
    resources.push(meshXml(id, obj, origin));
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(origin[0])} ${num(origin[1])} ${num(origin[2])}"/>`);
  });

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Title">${escapeXml(opts.title ?? '3D Splicer export')}</metadata>` +
    `<metadata name="Application">3D Splicer</metadata>` +
    `<resources>${resources.join('')}</resources>` +
    `<build>${items.join('')}</build>` +
    `</model>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
        `<Default Extension="txt" ContentType="text/plain"/>` +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
        `</Relationships>`,
    ),
    '3D/3dmodel.model': strToU8(model),
  };
  for (const [path, text] of Object.entries(opts.extras ?? {})) files[path] = strToU8(text);
  return zipSync(files, { level: 6 });
}
