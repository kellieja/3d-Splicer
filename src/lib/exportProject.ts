import { strToU8, zipSync } from 'fflate';
import type { FilamentProfile, PrintSettings, PrinterProfile } from '../types';
import type { TriangleSoup } from '../slicer/mesh';
import { build3mf, type ThreeMfObject } from './threemf';
import { HOW_TO_OPEN, toPrusaIni, toSettingsText } from './slicerConfig';

export interface SlicerProjectInput {
  modelName: string;
  /** The whole model as placed on the bed, before any cutting. */
  original: TriangleSoup;
  /** Pieces per plate, already laid flat and placed on the bed. */
  plates: ThreeMfObject[][];
  printer: PrinterProfile;
  filament: FilamentProfile;
  settings: PrintSettings;
}

/** Bambu Studio / OrcaSlicer lay plates out in a grid with this many columns. */
export function plateColumns(count: number): number {
  const v = Math.sqrt(count);
  const r = Math.round(v);
  return v > r ? r + 1 : r;
}

/**
 * A zip that opens in any slicer: one standard 3MF per plate, one with all
 * plates, the original model, and the print settings (supports off).
 */
export function buildSlicerProject(input: SlicerProjectInput): Uint8Array {
  const { printer, filament, settings } = input;
  const title = input.modelName.replace(/\.[^.]+$/, '');
  const noSupports = { ...settings, supports: false };
  const notes = { 'Metadata/3d-splicer-settings.txt': toSettingsText(printer, filament, noSupports) };
  const files: Record<string, Uint8Array> = {};

  input.plates.forEach((objects, i) => {
    files[`Plate ${i + 1}.3mf`] = build3mf(objects, { title: `${title} - plate ${i + 1}`, extras: notes });
  });

  // Every plate in one file, laid out like the plate grid in Bambu Studio / OrcaSlicer
  // (1.2 x bed size apart, rows going towards the front).
  const cols = plateColumns(input.plates.length);
  const all: ThreeMfObject[] = input.plates.flatMap((objects, i) => {
    const dx = (i % cols) * printer.bedX * 1.2;
    const dy = -Math.floor(i / cols) * printer.bedY * 1.2;
    return objects.map((o) => {
      const moved = new Float32Array(o.positions.length);
      for (let k = 0; k < moved.length; k += 3) {
        moved[k] = o.positions[k] + dx;
        moved[k + 1] = o.positions[k + 1] + dy;
        moved[k + 2] = o.positions[k + 2];
      }
      return { name: `Plate ${i + 1} - ${o.name}`, positions: moved };
    });
  });
  if (input.plates.length > 1) files['All plates.3mf'] = build3mf(all, { title: `${title} - all plates`, extras: notes });

  files['Original model.3mf'] = build3mf([{ name: `${title} (uncut)`, positions: input.original }], { title: `${title} - original` });
  files['settings.ini'] = strToU8(toPrusaIni(printer, filament, noSupports));
  files['SETTINGS.txt'] = strToU8(toSettingsText(printer, filament, noSupports));
  files['HOW TO OPEN.txt'] = strToU8(HOW_TO_OPEN);
  return zipSync(files, { level: 6 });
}
