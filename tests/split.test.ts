import { describe, expect, it } from 'vitest';
import { makeCube, makeSampleTower, placeOnBed, computeBounds, IDENTITY_TRANSFORM } from '../src/slicer/mesh';
import { autoCuts, cutsForPieceCount, connectedComponents, splitModel, plateSoup, meshVolume, DEFAULT_DOWELS, type Cuts } from '../src/slicer/split';
import { sliceMesh } from '../src/slicer/slice';
import { area } from '../src/slicer/geometry';
import { slice } from '../src/slicer';
import { BUILTIN_PRINTERS } from '../src/profiles/printers';
import { BUILTIN_FILAMENTS } from '../src/profiles/filaments';
import { DEFAULT_SETTINGS } from '../src/profiles/settings';

function sphere(r: number, n: number) {
  const t: number[] = [];
  const P = (i: number, j: number) => {
    const th = (i / n) * Math.PI, ph = (j / n) * 2 * Math.PI;
    return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
  };
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      t.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  return new Float32Array(t);
}

const ender = BUILTIN_PRINTERS.find((p) => p.id === 'creality-ender3-v2')!;
const k2 = BUILTIN_PRINTERS.find((p) => p.id === 'creality-k2-plus')!;
const pla = BUILTIN_FILAMENTS[0];
const settings = { ...DEFAULT_SETTINGS, supports: true };

function big(size: number, printer = ender) {
  return placeOnBed(makeCube(20), { ...IDENTITY_TRANSFORM, scale: [size / 20, size / 20, size / 20] }, printer);
}

describe('auto cuts', () => {
  it('uses no cuts when the model fits', () => {
    expect(autoCuts([100, 100, 100], ender, settings, DEFAULT_DOWELS)).toEqual([[], [], []]);
  });
  it('splits a 300 mm cube into 2×2×2 for a 220 mm printer', () => {
    const c = autoCuts([300, 300, 300], ender, settings, DEFAULT_DOWELS);
    expect(c.map((l) => l.length)).toEqual([1, 1, 1]);
    expect(c[0][0]).toBe(150);
  });
});

describe('splitModel', () => {
  const model = big(300);
  const opts = { cuts: autoCuts([300, 300, 300], ender, settings, DEFAULT_DOWELS), dowels: DEFAULT_DOWELS, autoOrient: true, printer: ender, settings };
  const res = splitModel(model, opts);

  it('makes 8 closed parts that add up to the original volume', () => {
    expect(res.parts.length).toBe(8);
    let total = 0;
    for (const p of res.parts) {
      const v = meshVolume(p.positions);
      expect(v).toBeGreaterThan(0); // normals point outwards
      total += v;
    }
    // Pins and holes nearly cancel out.
    expect(Math.abs(total - 300 ** 3) / 300 ** 3).toBeLessThan(0.002);
  });

  it('adds dowels on every joint', () => {
    // 12 internal faces in a 2×2×2 grid, 2 dowels each on these large faces.
    expect(res.dowels).toBe(24);
    expect(res.parts.reduce((n, p) => n + p.pins, 0)).toBe(24);
    expect(res.parts.reduce((n, p) => n + p.holes, 0)).toBe(24);
    expect(res.warnings).toEqual([]);
  });

  it('produces watertight parts the slicer can read', () => {
    for (const p of res.parts) {
      const b = computeBounds(p.positions);
      const mid = (b.min[2] + b.max[2]) / 2;
      const [region] = sliceMesh(p.positions, [mid]);
      expect(area(region)).toBeGreaterThan(150 * 150 * 0.95);
    }
  });

  it('packs every part onto plates that fit the bed', () => {
    const count = res.plates.reduce((n, p) => n + p.parts.length, 0);
    expect(count).toBe(8);
    for (const plate of res.plates) {
      const b = computeBounds(plateSoup(plate));
      expect(b.min[0]).toBeGreaterThanOrEqual(0);
      expect(b.max[0]).toBeLessThanOrEqual(220);
      expect(b.max[1]).toBeLessThanOrEqual(220);
      expect(b.min[2]).toBeCloseTo(0);
      expect(b.max[2]).toBeLessThanOrEqual(250);
    }
    expect(res.parts.every((p) => p.fits)).toBe(true);
  });

  it('never points a pin into the bed', () => {
    // Each placed part's lowest layer must be a flat face, not a pin tip.
    for (const plate of res.plates)
      for (const pp of plate.parts) {
        const [region] = sliceMesh(pp.positions, [0.1]);
        expect(area(region)).toBeGreaterThan(100 * 100);
      }
  });

  it('slices each plate', () => {
    const r = slice({ positions: plateSoup(res.plates[0]), printer: ender, filament: pla, settings });
    expect(r.stats.layerCount).toBeGreaterThan(100);
    expect(r.warnings).toEqual([]);
  });

  it('cuts real holes that match the pins', () => {
    const cube = big(200);
    const r = splitModel(cube, { ...opts, autoOrient: false, cuts: [[], [], [100]] });
    const [bottom, top] = r.parts;
    expect(bottom.pins).toBe(2);
    expect(top.holes).toBe(2);
    const rHole = (DEFAULT_DOWELS.diameter + DEFAULT_DOWELS.tolerance) / 2;
    const rPin = DEFAULT_DOWELS.diameter / 2;
    // Just above the cut: the top part has two holes, the pins stick up from the bottom part.
    const [topSection] = sliceMesh(top.positions, [102]);
    expect(area(topSection)).toBeCloseTo(200 * 200 - 2 * Math.PI * rHole ** 2, -1);
    const [pinSection] = sliceMesh(bottom.positions, [102]);
    expect(area(pinSection)).toBeCloseTo(2 * Math.PI * rPin ** 2, 0);
  });

  it('splits round models and still joins most parts with dowels', () => {
    const ball = placeOnBed(sphere(200, 160), IDENTITY_TRANSFORM, ender);
    const r = splitModel(ball, { ...opts, cuts: autoCuts([400, 400, 400], ender, settings, DEFAULT_DOWELS) });
    const vol = r.parts.reduce((n, p) => n + meshVolume(p.positions), 0);
    expect(Math.abs(vol / meshVolume(ball) - 1)).toBeLessThan(0.001);
    expect(r.parts.every((p) => p.fits)).toBe(true);
    // Only the small corner joints (near the curved surface) should be left without dowels.
    const joints = r.dowels > 0 ? r.warnings.length : Infinity;
    expect(joints).toBeLessThanOrEqual(8);
    // Pieces on the same plate never overlap.
    for (const plate of r.plates) {
      const boxes = plate.parts.map((pp) => computeBounds(pp.positions));
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const overlap = a.min[0] < b.max[0] - 0.01 && b.min[0] < a.max[0] - 0.01 && a.min[1] < b.max[1] - 0.01 && b.min[1] < a.max[1] - 0.01;
          expect(overlap).toBe(false);
        }
    }
    expect(r.dowels).toBeGreaterThanOrEqual(30);
  });

  it('places separate bits as their own pieces, flat on the plate', () => {
    // Two blocks side by side plus one block hovering above (like an arm): a cut leaves separate bits.
    const cube = (x: number, y: number, z: number, s: number) => {
      const c = makeCube(s);
      for (let i = 0; i < c.length; i += 3) { c[i] += x; c[i + 1] += y; c[i + 2] += z; }
      return c;
    };
    const blocks = [cube(0, 0, 0, 60), cube(100, 0, 0, 60), cube(100, 0, 120, 60)];
    const model = new Float32Array(blocks.reduce((n, b) => n + b.length, 0));
    let o = 0;
    for (const b of blocks) { model.set(b, o); o += b.length; }
    const placedModel = placeOnBed(model, IDENTITY_TRANSFORM, ender);
    const r = splitModel(placedModel, { ...opts, cuts: [[], [], []] });
    expect(r.parts.length).toBe(3);
    // Everything rests on the bed, and small pieces share plates.
    for (const plate of r.plates) for (const pp of plate.parts) expect(computeBounds(pp.positions).min[2]).toBeCloseTo(0);
    expect(r.plates.length).toBe(1);
  });

  it('finds connected pieces', () => {
    const a = makeCube(10);
    const b = makeCube(10).map((v, i) => (i % 3 === 0 ? v + 50 : v));
    const both = new Float32Array([...a, ...b]);
    expect(connectedComponents(both).length).toBe(2);
    expect(connectedComponents(a).length).toBe(1);
  });

  it('cuts into the number of pieces asked for', () => {
    const size: [number, number, number] = [180, 100, 60];
    const four = cutsForPieceCount(size, ender, settings, DEFAULT_DOWELS, 4);
    expect(four.minimum).toBe(1);
    expect(four.cuts.reduce((n, l) => n * (l.length + 1), 1)).toBe(4);
    expect(four.cuts[0].length).toBeGreaterThanOrEqual(1); // longest side gets cut first
    // Never fewer pieces than the printer needs.
    const tooFew = cutsForPieceCount([300, 300, 300], ender, settings, DEFAULT_DOWELS, 2);
    expect(tooFew.minimum).toBe(8);
    expect(tooFew.cuts.reduce((n, l) => n * (l.length + 1), 1)).toBe(8);
  });

  it('needs fewer plates on a bigger printer', () => {
    const r2 = splitModel(big(300, k2), { ...opts, printer: k2, cuts: autoCuts([300, 300, 300], k2, settings, DEFAULT_DOWELS) });
    expect(r2.parts.length).toBe(1);
    expect(r2.plates.length).toBe(1);
  });

  it('respects manual cuts and handles curved parts', () => {
    const tower = placeOnBed(makeSampleTower(40, 200, 96), IDENTITY_TRANSFORM, ender);
    const cuts: Cuts = [[], [], [70, 140]];
    const r = splitModel(tower, { ...opts, cuts });
    expect(r.parts.length).toBe(3);
    expect(r.dowels).toBeGreaterThanOrEqual(2);
    for (const p of r.parts) expect(meshVolume(p.positions)).toBeGreaterThan(0);
  });
});

describe('STL export', () => {
  it('writes a valid binary STL that loads back', async () => {
    const { toBinaryStl } = await import('../src/lib/stl');
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    const bytes = toBinaryStl(makeCube(20), 'cube');
    expect(bytes.length).toBe(84 + 12 * 50);
    const geo = new STLLoader().parse(bytes.buffer as ArrayBuffer);
    expect(geo.getAttribute('position').count).toBe(36);
  });
});

describe('project export', () => {
  it('writes standard 3MF files with each piece named and in place', async () => {
    const { build3mf } = await import('../src/lib/threemf');
    const { unzipSync, strFromU8 } = await import('fflate');
    const a = placeOnBed(makeCube(20), IDENTITY_TRANSFORM, ender);
    const files = unzipSync(build3mf([{ name: 'Piece 1 & co', positions: a }], { title: 'test' }));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']));
    const xml = strFromU8(files['3D/3dmodel.model']);
    expect(xml).toContain('name="Piece 1 &amp; co"');
    // 8 shared vertices and 12 triangles for a cube.
    expect(xml.match(/<vertex /g)!.length).toBe(8);
    expect(xml.match(/<triangle /g)!.length).toBe(12);
    // Vertex + build transform puts the cube back where it was on the bed.
    const t = /transform="1 0 0 0 1 0 0 0 1 ([\d.-]+) ([\d.-]+) ([\d.-]+)"/.exec(xml)!.slice(1).map(Number);
    const xs = [...xml.matchAll(/<vertex x="([\d.-]+)" y="([\d.-]+)" z="([\d.-]+)"/g)].map((m) => [+m[1] + t[0], +m[2] + t[1], +m[3] + t[2]]);
    const b = computeBounds(a);
    expect(Math.min(...xs.map((v) => v[0]))).toBeCloseTo(b.min[0], 3);
    expect(Math.max(...xs.map((v) => v[1]))).toBeCloseTo(b.max[1], 3);
    expect(Math.min(...xs.map((v) => v[2]))).toBeCloseTo(0, 5);
  });

  it('builds a project zip that works for every slicer', async () => {
    const { unzipSync, strFromU8 } = await import('fflate');
    const { buildSlicerProject } = await import('../src/lib/exportProject');
    const model = big(300);
    const r = splitModel(model, { cuts: autoCuts([300, 300, 300], ender, settings, DEFAULT_DOWELS), dowels: DEFAULT_DOWELS, autoOrient: true, printer: ender, settings });
    const zip = buildSlicerProject({
      modelName: 'cube.stl',
      original: model,
      plates: r.plates.map((pl) => pl.parts.map((pp) => ({ name: `Piece ${pp.part + 1}`, positions: pp.positions }))),
      printer: ender,
      filament: pla,
      settings,
    });
    const files = unzipSync(zip);
    const names = Object.keys(files);
    expect(names.filter((n) => /^Plate \d+\.3mf$/.test(n)).length).toBe(r.plates.length);
    expect(names).toEqual(expect.arrayContaining(['All plates.3mf', 'Original model.3mf', 'settings.ini', 'SETTINGS.txt', 'HOW TO OPEN.txt']));
    const ini = strFromU8(files['settings.ini']);
    expect(ini).toContain('support_material = 0');
    expect(ini).toContain('temperature = 210');
    expect(ini).toContain('bed_shape = 0x0,220x0,220x220,0x220');
    // Each plate file is a valid 3MF package with the model inside.
    const plate = unzipSync(files['Plate 1.3mf']);
    expect(strFromU8(plate['3D/3dmodel.model'])).toContain('<object id="1" name="Piece');
  });

  it('saves and reopens a 3D Splicer project', async () => {
    const { saveProject, loadProject } = await import('../src/lib/project');
    const cube = placeOnBed(makeCube(20), IDENTITY_TRANSFORM, ender);
    const state = {
      modelName: 'cube.stl', printer: ender, filament: pla, settings,
      transform: { ...IDENTITY_TRANSFORM, scale: [2, 2, 2] as [number, number, number] }, uniform: true,
      split: { enabled: true, pieces: 4, manualCuts: null, dowels: DEFAULT_DOWELS, autoOrient: true },
    };
    const back = loadProject(saveProject(cube, state));
    expect(back.state).toEqual(state);
    expect(back.model.length).toBe(cube.length);
    expect(() => loadProject(new Uint8Array([1, 2, 3]))).toThrow(/not a 3D Splicer project/);
  });
});

describe('angled cuts', () => {
  const model = () => big(200);
  const base = () => ({ dowels: DEFAULT_DOWELS, autoOrient: true, printer: ender, settings });

  it('cuts along a tilted plane and keeps every part solid', () => {
    const r = splitModel(model(), { ...base(), cuts: [[], [], [100]], tilts: [[], [], [[25, 0]]] });
    expect(r.parts.length).toBe(2);
    const n = r.planes[0].n;
    expect(Math.abs(n[2])).toBeCloseTo(Math.cos((25 * Math.PI) / 180), 6);
    let total = 0;
    for (const p of r.parts) {
      const v = meshVolume(p.positions);
      expect(v).toBeGreaterThan(0);
      total += v;
    }
    expect(Math.abs(total - 200 ** 3) / 200 ** 3).toBeLessThan(0.002);
    // The joint still gets pins and matching holes.
    expect(r.dowels).toBeGreaterThanOrEqual(2);
    expect(r.parts[0].pins + r.parts[1].pins).toBe(r.dowels);
    expect(r.parts[0].holes + r.parts[1].holes).toBe(r.dowels);
    expect(r.parts[0].joins).toEqual([1]);
    expect(r.parts[1].joins).toEqual([0]);
  });

  it('lays each piece flat, including on a tilted cut face', () => {
    const r = splitModel(model(), { ...base(), cuts: [[], [], [100]], tilts: [[], [], [[25, 0]]] });
    for (const plate of r.plates)
      for (const pp of plate.parts) {
        const b = computeBounds(pp.positions);
        expect(b.min[2]).toBeCloseTo(0, 4);
        const [region] = sliceMesh(pp.positions, [0.1]);
        expect(area(region)).toBeGreaterThan(150 * 150); // big flat face on the bed
      }
  });

  it('handles tilted cuts in several directions on a round model', () => {
    const ball = placeOnBed(sphere(90, 96), IDENTITY_TRANSFORM, ender);
    const r = splitModel(ball, { ...base(), cuts: [[90], [], [90]], tilts: [[[0, 20]], [], [[-15, 10]]] });
    expect(r.parts.length).toBe(4);
    const vol = r.parts.reduce((n, p) => n + meshVolume(p.positions), 0);
    expect(Math.abs(vol / meshVolume(ball) - 1)).toBeLessThan(0.002);
    for (const p of r.parts) expect(meshVolume(p.positions)).toBeGreaterThan(0);
  });

  it('zero tilt gives the same result as a straight cut', () => {
    const a = splitModel(model(), { ...base(), cuts: [[], [], [100]] });
    const b = splitModel(model(), { ...base(), cuts: [[], [], [100]], tilts: [[], [], [[0, 0]]] });
    expect(b.parts.map((p) => p.positions.length)).toEqual(a.parts.map((p) => p.positions.length));
  });
});

describe('assembly guide', () => {
  it('builds a valid PDF listing every piece', async () => {
    const { buildGuidePdf, guidePieces } = await import('../src/lib/assemblyGuide');
    const r = splitModel(big(300), { cuts: autoCuts([300, 300, 300], ender, settings, DEFAULT_DOWELS), dowels: DEFAULT_DOWELS, autoOrient: true, printer: ender, settings });
    const pieces = guidePieces(r, [0xff0000, 0x00ff00]);
    expect(pieces.length).toBe(8);
    expect(pieces.every((p) => p.plate >= 1 && p.joins.length === 3)).toBe(true); // each corner cube touches 3 others
    // A tiny valid JPEG (1×1 px) stands in for the rendered picture.
    const jpeg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='), (c) => c.charCodeAt(0));
    const pdf = buildGuidePdf({ title: 'cube.stl', lines: ['8 pieces on 8 plates'], pieces }, { jpeg, width: 1, height: 1 });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('(Assembly guide) Tj');
    expect(text).toContain('/Filter /DCTDecode');
    // The cross-reference table points at real objects.
    const xref = +/startxref\n(\d+)/.exec(text)![1];
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => +m[1]);
    for (const [i, off] of offsets.entries()) expect(text.slice(off).startsWith(`${i + 1} 0 obj`)).toBe(true);
  });
});
