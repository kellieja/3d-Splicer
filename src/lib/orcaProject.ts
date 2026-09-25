import type { FilamentProfile, PrintSettings, PrinterProfile } from '../types';
import { lineWidthFor } from '../slicer';
import { build3mf, type ThreeMfObject } from './threemf';

/*
 * EXPERIMENTAL: a 3MF with plates already set up for OrcaSlicer and the
 * slicers built on it (Creality Print, Bambu Studio, Elegoo / Anycubic
 * slicers). On top of the standard 3MF it adds:
 *
 *   Metadata/model_settings.config    which piece goes on which plate
 *   Metadata/project_settings.config  printer / filament / print settings (JSON)
 *
 * Orca only reads the plate list when the project settings are present, and
 * it needs "filament_colour" in them. The pieces are placed on the plate grid
 * the way Orca lays plates out: 1.2 x bed size apart, rows going towards -Y.
 */

/** Bambu Studio / OrcaSlicer lay plates out in a grid with this many columns. */
export function plateColumns(count: number): number {
  const v = Math.sqrt(count);
  const r = Math.round(v);
  return v > r ? r + 1 : r;
}

/** Gap between plates in the Orca plate grid, as a fraction of the bed size. */
const PLATE_STRIDE = 1.2;

export function plateOffset(index: number, count: number, printer: PrinterProfile): [number, number] {
  const cols = plateColumns(count);
  return [(index % cols) * printer.bedX * PLATE_STRIDE, -Math.floor(index / cols) * printer.bedY * PLATE_STRIDE];
}

export function movePositions(positions: Float32Array, dx: number, dy: number): Float32Array {
  const moved = new Float32Array(positions.length);
  for (let k = 0; k < moved.length; k += 3) {
    moved[k] = positions[k] + dx;
    moved[k + 1] = positions[k + 1] + dy;
    moved[k + 2] = positions[k + 2];
  }
  return moved;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const meta = (key: string, value: string | number) => `<metadata key="${key}" value="${escapeXml(String(value))}"/>`;

/** model_settings.config: one <plate> per plate listing its pieces (3MF object ids start at 1). */
export function modelSettingsXml(plates: ThreeMfObject[][]): string {
  let id = 0;
  const body = plates
    .map((objects, i) => {
      const instances = objects
        .map(() => {
          id++;
          return `  <model_instance>\n    ${meta('object_id', id)}\n    ${meta('instance_id', 0)}\n    ${meta('identify_id', id)}\n  </model_instance>`;
        })
        .join('\n');
      return `<plate>\n  ${meta('plater_id', i + 1)}\n  ${meta('plater_name', `Plate ${i + 1}`)}\n  ${meta('locked', 'false')}\n${instances}\n</plate>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${body}\n</config>\n`;
}

const ORCA_FILL: Record<PrintSettings['infillPattern'], string> = { lines: 'line', grid: 'grid', triangles: 'triangles' };
const ORCA_SEAM: Record<NonNullable<PrintSettings['seam']>, string> = { aligned: 'aligned', nearest: 'nearest', rear: 'back', random: 'random' };

/** project_settings.config (JSON). Supports are off so people add their own. */
export function projectSettingsJson(printer: PrinterProfile, filament: FilamentProfile, s: PrintSettings): string {
  const x0 = printer.originCenter ? -printer.bedX / 2 : 0;
  const y0 = printer.originCenter ? -printer.bedY / 2 : 0;
  const area =
    printer.bedShape === 'circle'
      ? Array.from({ length: 64 }, (_, i) => {
          const a = (i / 64) * Math.PI * 2;
          const r = printer.bedX / 2;
          return `${+(Math.cos(a) * r).toFixed(2)}x${+(Math.sin(a) * r).toFixed(2)}`;
        })
      : [`${x0}x${y0}`, `${x0 + printer.bedX}x${y0}`, `${x0 + printer.bedX}x${y0 + printer.bedY}`, `${x0}x${y0 + printer.bedY}`];
  const speed = (v: number) => String(Math.min(v, printer.maxPrintSpeed, filament.maxSpeed));
  const bed = String(printer.heatedBed ? filament.bedTemp : 0);
  const material = filament.material === 'Composite' || filament.material === 'Other' ? 'PLA' : filament.material.toUpperCase();
  const cfg: Record<string, string | string[]> = {
    from: 'project',
    name: '3D Splicer',
    printer_settings_id: `3D Splicer - ${printer.manufacturer} ${printer.name}`,
    print_settings_id: '3D Splicer - print',
    filament_settings_id: [`3D Splicer - ${filament.name}`],
    printer_technology: 'FFF',
    printable_area: area,
    printable_height: String(printer.maxZ),
    nozzle_diameter: [String(s.nozzleDiameter)],
    filament_diameter: [String(printer.filamentDiameter)],
    filament_colour: ['#F2754E'],
    filament_type: [material],
    nozzle_temperature: [String(filament.nozzleTemp)],
    nozzle_temperature_initial_layer: [String(filament.firstLayerNozzleTemp)],
    hot_plate_temp: [bed],
    hot_plate_temp_initial_layer: [bed],
    textured_plate_temp: [bed],
    textured_plate_temp_initial_layer: [bed],
    fan_max_speed: [String(filament.fanSpeed)],
    fan_min_speed: [String(filament.fanSpeed)],
    filament_flow_ratio: [String(filament.flow)],
    filament_density: [String(filament.density)],
    filament_cost: [String(filament.costPerKg)],
    retraction_length: [String(+(printer.retractLength * filament.retractFactor).toFixed(2))],
    retraction_speed: [String(printer.retractSpeed)],
    z_hop: [String(s.zHop)],
    layer_height: String(s.layerHeight),
    initial_layer_print_height: String(s.firstLayerHeight),
    line_width: String(lineWidthFor(s)),
    wall_loops: String(s.wallCount),
    top_shell_layers: String(s.topLayers),
    bottom_shell_layers: String(s.bottomLayers),
    sparse_infill_density: `${s.infillDensity}%`,
    sparse_infill_pattern: ORCA_FILL[s.infillPattern],
    outer_wall_speed: speed(s.outerWallSpeed),
    inner_wall_speed: speed(s.printSpeed),
    sparse_infill_speed: speed(s.printSpeed),
    internal_solid_infill_speed: speed(s.printSpeed),
    initial_layer_speed: String(s.firstLayerSpeed),
    travel_speed: String(s.travelSpeed),
    seam_position: ORCA_SEAM[s.seam ?? 'aligned'],
    ironing_type: s.ironing ? 'top' : 'no ironing',
    ironing_flow: `${s.ironingFlow}%`,
    ironing_speed: String(s.ironingSpeed),
    ironing_spacing: String(s.ironingSpacing),
    enable_support: '0',
    brim_type: s.adhesion === 'brim' ? 'outer_only' : 'no_brim',
    brim_width: String(s.adhesion === 'brim' ? s.brimWidth : 0),
    skirt_loops: String(s.adhesion === 'skirt' ? s.skirtLoops : 0),
    skirt_distance: String(s.skirtDistance),
  };
  return JSON.stringify(cfg, null, 4) + '\n';
}

export interface OrcaProjectInput {
  title: string;
  /** Pieces per plate, already laid flat and placed on the bed. */
  plates: ThreeMfObject[][];
  printer: PrinterProfile;
  filament: FilamentProfile;
  settings: PrintSettings;
}

/** Builds the experimental multi-plate project file. */
export function buildOrcaProject3mf(input: OrcaProjectInput): Uint8Array {
  const { plates, printer } = input;
  const settings = { ...input.settings, supports: false };
  const objects = plates.flatMap((list, i) => {
    const [dx, dy] = plateOffset(i, plates.length, printer);
    return list.map((o) => ({ name: `Plate ${i + 1} - ${o.name}`, positions: movePositions(o.positions, dx, dy) }));
  });
  return build3mf(objects, {
    title: input.title,
    extras: {
      'Metadata/model_settings.config': modelSettingsXml(plates),
      'Metadata/project_settings.config': projectSettingsJson(printer, input.filament, settings),
    },
  });
}
