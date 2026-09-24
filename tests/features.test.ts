import { describe, expect, it } from 'vitest';
import { makeCube, makeSampleTower, placeOnBed, IDENTITY_TRANSFORM } from '../src/slicer/mesh';
import { slice } from '../src/slicer';
import { BUILTIN_PRINTERS } from '../src/profiles/printers';
import { BUILTIN_FILAMENTS } from '../src/profiles/filaments';
import { DEFAULT_SETTINGS } from '../src/profiles/settings';
import type { PrintSettings } from '../src/types';

const printer = BUILTIN_PRINTERS.find((p) => p.id === 'creality-ender3-v2')!;
const pla = BUILTIN_FILAMENTS[0];

function joined(...soups: Float32Array[]) {
  const out = new Float32Array(soups.reduce((n, s) => n + s.length, 0));
  let o = 0;
  for (const s of soups) { out.set(s, o); o += s.length; }
  return out;
}
function cubeAt(x: number, y: number, z: number, size: number) {
  const c = makeCube(size);
  for (let i = 0; i < c.length; i += 3) { c[i] += x; c[i + 1] += y; c[i + 2] += z; }
  return c;
}
/** A 40 mm block with a 20 mm block on top: has a step halfway up. */
const stepped = () => placeOnBed(joined(cubeAt(0, 0, 0, 40), cubeAt(10, 10, 40, 20)), IDENTITY_TRANSFORM, printer);
const run = (positions: Float32Array, over: Partial<PrintSettings>) =>
  slice({ positions, printer, filament: pla, settings: { ...DEFAULT_SETTINGS, ...over } });

/** Layers (0-based) that contain a given ;TYPE. */
function layersWith(gcode: string, type: string): number[] {
  const out: number[] = [];
  let layer = -1;
  for (const line of gcode.split('\n')) {
    if (line.startsWith(';LAYER:')) layer = +line.slice(7);
    else if (line === `;TYPE:${type}` && out[out.length - 1] !== layer) out.push(layer);
  }
  return out;
}

describe('ironing', () => {
  it('is off by default', () => {
    expect(run(placeOnBed(makeCube(20), IDENTITY_TRANSFORM, printer), {}).gcode).not.toContain(';TYPE:IRONING');
  });

  it('irons only the very top surface, not steps partway up', () => {
    const r = run(stepped(), { ironing: true });
    expect(layersWith(r.gcode, 'IRONING')).toEqual([r.stats.layerCount - 1]);
  });

  it('uses little plastic and a slow speed', () => {
    const cube = placeOnBed(makeCube(20), IDENTITY_TRANSFORM, printer);
    const off = run(cube, {});
    const on = run(cube, { ironing: true });
    const extra = on.stats.filamentLength - off.stats.filamentLength;
    expect(extra).toBeGreaterThan(0);
    // ~12 % of one 0.2 mm layer over 20×20 mm ≈ 0.1 cm³ ≈ 4 cm of filament.
    expect(extra).toBeLessThan(0.1);
    const ironLines = on.gcode.split(';TYPE:IRONING')[1].split('\n').filter((l) => l.startsWith('G1 X'));
    expect(ironLines.some((l) => l.endsWith(`F${15 * 60}`))).toBe(true);
  });
});

describe('seam placement', () => {
  /** Start point of every outer wall, per layer. */
  function outerStarts(gcode: string): [number, number][] {
    const out: [number, number][] = [];
    const lines = gcode.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] !== ';TYPE:WALL-OUTER') continue;
      for (let j = i + 1; j < lines.length; j++) {
        const m = /^G0 X([\d.-]+) Y([\d.-]+)/.exec(lines[j]);
        if (m) { out.push([+m[1], +m[2]]); break; }
      }
    }
    return out;
  }
  const tower = placeOnBed(makeSampleTower(15, 20, 96), IDENTITY_TRANSFORM, printer);

  it('aligned keeps the seam in one vertical line', () => {
    // Same direction from the centre on every layer (the cone makes the circle shrink, so compare angles).
    const starts = outerStarts(run(tower, { seam: 'aligned' }).gcode).filter(([x, y]) => Math.hypot(x - 110, y - 110) > 2);
    const angles = starts.map(([x, y]) => (Math.atan2(y - 110, x - 110) * 180) / Math.PI);
    expect(Math.max(...angles) - Math.min(...angles)).toBeLessThan(15);
  });

  it('aligned tucks the seam into a corner on boxy parts', () => {
    const cube = placeOnBed(makeCube(20), IDENTITY_TRANSFORM, printer);
    for (const [x, y] of outerStarts(run(cube, { seam: 'aligned' }).gcode)) {
      const nearCornerX = Math.min(Math.abs(x - 100), Math.abs(x - 120)) < 0.6;
      const nearCornerY = Math.min(Math.abs(y - 100), Math.abs(y - 120)) < 0.6;
      expect(nearCornerX && nearCornerY).toBe(true);
    }
  });

  it('rear puts the seam at the back', () => {
    for (const [x, y] of outerStarts(run(tower, { seam: 'rear' }).gcode)) {
      expect(y).toBeGreaterThan(110);
      expect(Math.abs(x - 110)).toBeLessThan(1.5);
    }
  });

  it('random scatters the seam but is repeatable', () => {
    const a = outerStarts(run(tower, { seam: 'random' }).gcode);
    const b = outerStarts(run(tower, { seam: 'random' }).gcode);
    expect(a).toEqual(b);
    const angles = new Set(a.map(([x, y]) => Math.round((Math.atan2(y - 110, x - 110) * 180) / Math.PI / 30)));
    expect(angles.size).toBeGreaterThan(6);
  });
});

describe('variable layer height', () => {
  const tower = () => placeOnBed(makeSampleTower(15, 20, 96), IDENTITY_TRANSFORM, printer); // straight wall then a cone
  const heights = (zs: number[]) => zs.map((z, i) => +(i ? z - zs[i - 1] : z).toFixed(3));

  it('adaptive uses thick layers on straight walls and thin ones on slopes', async () => {
    const { computeLayerHeights } = await import('../src/slicer/layers');
    const t = tower();
    const zs = computeLayerHeights(t, 35, { ...DEFAULT_SETTINGS, adaptiveLayers: true, adaptiveQuality: 70 });
    const hs = heights(zs);
    const wall = hs.filter((_, i) => zs[i] > 3 && zs[i] < 17);
    const cone = hs.filter((_, i) => zs[i] > 21 && zs[i] < 34);
    expect(Math.min(...wall)).toBeGreaterThan(0.25);
    expect(Math.max(...cone)).toBeLessThan(0.15);
    expect(zs[zs.length - 1]).toBeCloseTo(35, 3);
  });

  it('higher quality means more layers', async () => {
    const { computeLayerHeights } = await import('../src/slicer/layers');
    const t = tower();
    const fast = computeLayerHeights(t, 35, { ...DEFAULT_SETTINGS, adaptiveLayers: true, adaptiveQuality: 0 });
    const fine = computeLayerHeights(t, 35, { ...DEFAULT_SETTINGS, adaptiveLayers: true, adaptiveQuality: 100 });
    expect(fine.length).toBeGreaterThan(fast.length * 1.5);
  });

  it('manual ranges set the layer height inside them', async () => {
    const { computeLayerHeights } = await import('../src/slicer/layers');
    const cube = placeOnBed(makeCube(20), IDENTITY_TRANSFORM, printer);
    const zs = computeLayerHeights(cube, 20, { ...DEFAULT_SETTINGS, layerRanges: [{ from: 5, to: 10, height: 0.1 }] });
    const hs = heights(zs);
    const inside = hs.filter((_, i) => zs[i] > 5.15 && zs[i] <= 10);
    const outside = hs.filter((_, i) => zs[i] > 11 && zs[i] < 19.5);
    expect(new Set(inside)).toEqual(new Set([0.1]));
    expect(new Set(outside)).toEqual(new Set([0.2]));
    expect(zs).toContain(10);
  });

  it('slices and writes G-code with changing layer heights', () => {
    const r = run(tower(), { adaptiveLayers: true, adaptiveQuality: 60 });
    expect(r.warnings).toEqual([]);
    const zs = [...r.gcode.matchAll(/^; z = ([\d.]+)/gm)].map((m) => +m[1]);
    expect(zs.length).toBe(r.stats.layerCount);
    const hs = new Set(heights(zs).slice(1));
    expect(hs.size).toBeGreaterThan(3);
  });
});
