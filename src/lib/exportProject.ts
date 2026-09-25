import { strToU8, zipSync } from 'fflate';
import type { FilamentProfile, PrintSettings, PrinterProfile } from '../types';
import type { TriangleSoup } from '../slicer/mesh';
import { build3mf, type ThreeMfObject } from './threemf';
import { buildOrcaProject3mf } from './orcaProject';
import { HOW_TO_OPEN, toPrusaIni, toSettingsText } from './slicerConfig';

export { plateColumns } from './orcaProject';

/** File name of the experimental multi-plate project. */
export const ORCA_BETA_FILE = 'Creality-Orca project (beta).3mf';

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

  if (input.plates.length > 1) {
    // Every piece in one file, each at its spot on its own plate but all laid over plate 1,
    // so every slicer opens it without "outside the plate" errors. Press Arrange to spread
    // the pieces over as many plates as needed.
    const all = input.plates.flatMap((objects, i) => objects.map((o) => ({ ...o, name: `Plate ${i + 1} - ${o.name}` })));
    files['All plates.3mf'] = build3mf(all, { title: `${title} - all plates`, extras: notes });
    // Experimental: plates already set up for Creality Print / OrcaSlicer / Bambu Studio.
    files[ORCA_BETA_FILE] = buildOrcaProject3mf({ title: `${title} - all plates`, plates: input.plates, printer, filament, settings: noSupports });
  }

  files['Original model.3mf'] = build3mf([{ name: `${title} (uncut)`, positions: input.original }], { title: `${title} - original` });
  files['settings.ini'] = strToU8(toPrusaIni(printer, filament, noSupports));
  files['SETTINGS.txt'] = strToU8(toSettingsText(printer, filament, noSupports));
  files['HOW TO OPEN.txt'] = strToU8(HOW_TO_OPEN);
  return zipSync(files, { level: 6 });
}
