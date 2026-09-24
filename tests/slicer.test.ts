import { describe, expect, it } from 'vitest';
import { makeCube, makeSampleTower, placeOnBed, computeBounds, fitScale, checkFits, IDENTITY_TRANSFORM } from '../src/slicer/mesh';
import { layerHeights, sliceMesh } from '../src/slicer/slice';
import { area } from '../src/slicer/geometry';
import { slice } from '../src/slicer';
import { extrusionArea, fillTemplate } from '../src/slicer/gcode';
import { BUILTIN_PRINTERS } from '../src/profiles/printers';
import { BUILTIN_FILAMENTS } from '../src/profiles/filaments';
import { DEFAULT_SETTINGS } from '../src/profiles/settings';

const printer = BUILTIN_PRINTERS.find((p) => p.id === 'creality-ender3-v2')!;
const pla = BUILTIN_FILAMENTS.find((f) => f.id === 'pla')!;

describe('mesh placement', () => {
  it('centres the model on the bed and drops it to Z=0', () => {
    const cube = placeOnBed(makeCube(20), IDENTITY_TRANSFORM, printer);
    const b = computeBounds(cube);
    expect(b.min[2]).toBeCloseTo(0);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(110);
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(110);
  });

  it('scales and rotates', () => {
    const t = { ...IDENTITY_TRANSFORM, scale: [2, 1, 0.5] as [number, number, number], rotation: [0, 0, 90] as [number, number, number] };
    const b = computeBounds(placeOnBed(makeCube(20), t, printer));
    expect(b.max[0] - b.min[0]).toBeCloseTo(20); // rotated: Y size becomes X
    expect(b.max[1] - b.min[1]).toBeCloseTo(40);
    expect(b.max[2] - b.min[2]).toBeCloseTo(10);
  });

  it('detects models that do not fit', () => {
    const big = placeOnBed(makeCube(300), IDENTITY_TRANSFORM, printer);
    expect(checkFits(computeBounds(big), printer).length).toBeGreaterThan(0);
    expect(fitScale([300, 300, 300], printer)).toBeLessThan(1);
  });
});

describe('slicing', () => {
  it('computes layer heights', () => {
    const zs = layerHeights(10, 0.3, 0.2);
    expect(zs[0]).toBe(0.3);
    expect(zs.length).toBe(50);
    expect(zs[zs.length - 1]).toBeCloseTo(10);
  });

  it('slices a cube into square cross-sections', () => {
    const regions = sliceMesh(makeCube(20), [0.1, 10, 19.9]);
    for (const r of regions) {
      expect(r.length).toBe(1);
      expect(area(r)).toBeCloseTo(400, 1);
    }
  });

  it('slices through a plane that passes exactly through vertices', () => {
    // z = 30 is the ring where the cylinder meets the cone.
    const [region] = sliceMesh(makeSampleTower(12, 30, 64), [30]);
    expect(Math.abs(area(region) - Math.PI * 144) / (Math.PI * 144)).toBeLessThan(0.01);
  });

  it('slices a cylinder into circles', () => {
    const regions = sliceMesh(makeSampleTower(10, 20, 128), [5]);
    expect(Math.abs(area(regions[0]) - Math.PI * 100) / (Math.PI * 100)).toBeLessThan(0.01);
  });
});

describe('full pipeline', () => {
  const cube = placeOnBed(makeCube(20), IDENTITY_TRANSFORM, printer);

  it('produces valid G-code for a 20 mm cube', () => {
    const res = slice({ positions: cube, printer, filament: pla, settings: DEFAULT_SETTINGS });
    const lines = res.gcode.split('\n');
    expect(res.warnings).toEqual([]);
    expect(res.stats.layerCount).toBe(1 + Math.round((20 - 0.24) / 0.2));
    expect(res.gcode).toContain('M104 S215'); // first-layer temp substituted
    expect(res.gcode).not.toMatch(/\{\w+\}/); // no leftover placeholders
    expect(lines.filter((l) => l.startsWith(';LAYER:')).length).toBe(res.stats.layerCount);
    // Every move stays on the bed.
    for (const l of lines) {
      const m = /^G[01] X([\d.-]+) Y([\d.-]+)/.exec(l);
      if (!m) continue;
      expect(+m[1]).toBeGreaterThanOrEqual(0);
      expect(+m[1]).toBeLessThanOrEqual(220);
    }
    // A 20 mm cube with 2 walls and 15 % infill is ~2900 mm³ ≈ 1.2 m of 1.75 mm filament.
    expect(res.stats.filamentLength).toBeGreaterThan(0.8);
    expect(res.stats.filamentLength).toBeLessThan(2);
    expect(res.stats.estimatedTime).toBeGreaterThan(5 * 60);
    expect(res.preview.layerEnds.length).toBe(res.stats.layerCount);
  });

  it('uses more filament at higher infill', () => {
    const low = slice({ positions: cube, printer, filament: pla, settings: { ...DEFAULT_SETTINGS, infillDensity: 10 } });
    const high = slice({ positions: cube, printer, filament: pla, settings: { ...DEFAULT_SETTINGS, infillDensity: 60 } });
    expect(high.stats.filamentLength).toBeGreaterThan(low.stats.filamentLength * 1.5);
  });

  it('generates supports under overhangs', () => {
    // A cube rotated 45° on its edge has large overhangs.
    const t = { ...IDENTITY_TRANSFORM, rotation: [45, 0, 0] as [number, number, number] };
    const tilted = placeOnBed(makeCube(20), t, printer);
    const res = slice({ positions: tilted, printer, filament: pla, settings: { ...DEFAULT_SETTINGS, supports: true, supportAngle: 40 } });
    expect(res.gcode).toContain(';TYPE:SUPPORT');
  });

  it('works on round delta beds with centre origin', () => {
    const delta = BUILTIN_PRINTERS.find((p) => p.id === 'generic-delta')!;
    const res = slice({ positions: placeOnBed(makeCube(20), IDENTITY_TRANSFORM, delta), printer: delta, filament: pla, settings: DEFAULT_SETTINGS });
    expect(res.warnings).toEqual([]);
    expect(res.gcode).toMatch(/G1 X-\d/);
  });
  it('slices for the Creality K2 Plus (350 mm Klipper printer)', () => {
    const k2 = BUILTIN_PRINTERS.find((p) => p.id === 'creality-k2-plus')!;
    const petg = BUILTIN_FILAMENTS.find((f) => f.id === 'petg')!;
    const big = placeOnBed(makeCube(20), { ...IDENTITY_TRANSFORM, scale: [15, 15, 15] }, k2); // 300 mm cube
    const res = slice({ positions: big, printer: k2, filament: petg, settings: { ...DEFAULT_SETTINGS, layerHeight: 0.28, firstLayerHeight: 0.28, printSpeed: 300 } });
    expect(res.warnings).toEqual([]);
    expect(res.gcode).toContain('START_PRINT EXTRUDER_TEMP=240 BED_TEMP=80');
    expect(res.gcode).toContain('END_PRINT');
    expect(res.gcode).toMatch(/G1 X\d+\.\d+ Y\d+\.\d+ E[\d.]+ F18000/); // 300 mm/s allowed
  });
});

describe('profiles', () => {
  it('have unique ids and sane values', () => {
    const ids = new Set(BUILTIN_PRINTERS.map((p) => p.id));
    expect(ids.size).toBe(BUILTIN_PRINTERS.length);
    for (const p of BUILTIN_PRINTERS) {
      expect(p.bedX).toBeGreaterThan(50);
      expect(p.maxZ).toBeGreaterThan(50);
      expect([1.75, 2.85]).toContain(p.filamentDiameter);
    }
    expect(new Set(BUILTIN_FILAMENTS.map((f) => f.id)).size).toBe(BUILTIN_FILAMENTS.length);
  });

  it('fills templates', () => {
    expect(fillTemplate('M104 S{nozzle_temp} {unknown}', { nozzle_temp: 200 })).toBe('M104 S200 {unknown}');
    expect(extrusionArea(0.45, 0.2)).toBeCloseTo(0.0814, 3);
  });
});
