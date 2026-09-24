import { describe, expect, it } from 'vitest';
import { makeCube, makeSampleTower, placeOnBed, computeBounds, IDENTITY_TRANSFORM } from '../src/slicer/mesh';
import { autoCuts, splitModel, plateSoup, meshVolume, DEFAULT_DOWELS, type Cuts } from '../src/slicer/split';
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
    expect(r.dowels).toBeGreaterThanOrEqual(30);
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
