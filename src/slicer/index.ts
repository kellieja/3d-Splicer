import type {
  FilamentProfile,
  Layer,
  PathKind,
  PreviewData,
  PrintSettings,
  PrinterProfile,
  SliceResult,
} from '../types';
import { computeBounds, checkFits, type TriangleSoup } from './mesh';
import { sliceMesh } from './slice';
import { computeLayerHeights } from './layers';
import { generateToolpaths } from './toolpaths';
import { generateGcode } from './gcode';

export interface SliceRequest {
  /** Triangle soup already placed on the bed (see placeOnBed). */
  positions: TriangleSoup;
  printer: PrinterProfile;
  filament: FilamentProfile;
  settings: PrintSettings;
  modelName?: string;
}

export type ProgressFn = (stage: string, fraction: number) => void;

export function lineWidthFor(settings: PrintSettings): number {
  return +(settings.nozzleDiameter * 1.125).toFixed(3);
}

export function validateSettings(req: SliceRequest): string[] {
  const { settings: s, printer: p, filament: f } = req;
  const warnings: string[] = [];
  if (s.layerHeight > s.nozzleDiameter * 0.8)
    warnings.push(`Layer height ${s.layerHeight} mm is more than 80 % of the ${s.nozzleDiameter} mm nozzle; layers may not stick.`);
  if (f.nozzleTemp > p.maxNozzleTemp)
    warnings.push(`${f.name} needs ${f.nozzleTemp} °C but this printer's hot end is rated for ${p.maxNozzleTemp} °C.`);
  if (p.heatedBed && f.bedTemp > p.maxBedTemp)
    warnings.push(`${f.name} wants a ${f.bedTemp} °C bed; this printer reaches ${p.maxBedTemp} °C.`);
  if (!p.heatedBed && f.bedTemp > 0 && f.material !== 'PLA')
    warnings.push(`${f.name} usually needs a heated bed, which this printer doesn't have.`);
  if (s.printSpeed > p.maxPrintSpeed)
    warnings.push(`Print speed is capped at ${p.maxPrintSpeed} mm/s for this printer.`);
  if (s.printSpeed > f.maxSpeed)
    warnings.push(`Print speed is capped at ${f.maxSpeed} mm/s for ${f.name}.`);
  return warnings;
}

export function slice(req: SliceRequest, onProgress: ProgressFn = () => {}): SliceResult {
  const { positions, settings } = req;
  const warnings = [...validateSettings(req)];
  const bounds = computeBounds(positions);
  warnings.push(...checkFits(bounds, req.printer));

  const lw = lineWidthFor(settings);
  const zs = computeLayerHeights(positions, bounds.max[2], settings);
  // Slice through the middle of every layer.
  const planes = zs.map((z, i) => (i === 0 ? z / 2 : z - (z - zs[i - 1]) / 2));

  onProgress('Slicing mesh', 0);
  const regions = sliceMesh(positions, planes);
  onProgress('Slicing mesh', 1);

  const layers = generateToolpaths(regions, {
    settings,
    lineWidth: lw,
    zs,
    onProgress: (f) => onProgress('Generating toolpaths', f),
  });

  if (layers.every((l) => l.paths.length === 0)) warnings.push('Nothing to print: the model produced no printable layers.');

  onProgress('Writing G-code', 0);
  const { gcode, stats } = generateGcode(layers, {
    printer: req.printer,
    filament: req.filament,
    settings,
    lineWidth: lw,
    modelName: req.modelName,
  });
  onProgress('Writing G-code', 1);

  return { gcode, stats, preview: buildPreview(layers), warnings };
}

export const KIND_COLORS: Record<PathKind, [number, number, number]> = {
  'outer-wall': [0.98, 0.55, 0.2],
  'inner-wall': [0.99, 0.8, 0.3],
  'solid-infill': [0.85, 0.3, 0.45],
  'sparse-infill': [0.55, 0.36, 0.9],
  support: [0.3, 0.75, 0.9],
  skirt: [0.4, 0.85, 0.5],
  ironing: [0.9, 0.95, 1],
};

export function buildPreview(layers: Layer[]): PreviewData {
  let vertexCount = 0;
  for (const l of layers)
    for (const p of l.paths) {
      const segs = p.points.length / 2 - 1 + (p.closed ? 1 : 0);
      vertexCount += Math.max(0, segs) * 2;
    }

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const layerEnds = new Uint32Array(layers.length);
  const layerZ = new Float32Array(layers.length);
  let v = 0;
  const put = (x: number, y: number, z: number, c: [number, number, number]) => {
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    colors[v * 3] = c[0];
    colors[v * 3 + 1] = c[1];
    colors[v * 3 + 2] = c[2];
    v++;
  };

  layers.forEach((l, li) => {
    // Draw lines at the middle of the extruded bead.
    const z = l.z - l.height / 2;
    for (const p of l.paths) {
      const c = KIND_COLORS[p.kind];
      const pts = p.points;
      const n = pts.length / 2;
      const segs = n - 1 + (p.closed ? 1 : 0);
      for (let k = 0; k < segs; k++) {
        const a = k * 2, b = ((k + 1) % n) * 2;
        put(pts[a], pts[a + 1], z, c);
        put(pts[b], pts[b + 1], z, c);
      }
    }
    layerEnds[li] = v;
    layerZ[li] = l.z;
  });

  return { positions, colors, layerEnds, layerZ };
}
