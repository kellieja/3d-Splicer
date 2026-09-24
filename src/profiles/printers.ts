import type { PrinterProfile } from '../types';

/*
 * Built-in printer profiles.
 *
 * Numbers come from the manufacturers' published specs and are meant as good
 * starting points. Always check the start G-code against your own machine,
 * and feel free to open a pull request to improve or add a printer
 * (see docs/ADDING_PRINTERS.md).
 */

const MARLIN_START = `G90 ; absolute positioning
M82 ; absolute extrusion
M140 S{first_layer_bed_temp} ; start heating bed
M104 S{first_layer_nozzle_temp} ; start heating nozzle
G28 ; home all axes
M190 S{first_layer_bed_temp} ; wait for bed
M109 S{first_layer_nozzle_temp} ; wait for nozzle
G92 E0
G1 Z2.0 F3000
G1 X5 Y10 Z0.3 F5000 ; move to prime line start
G1 X5 Y100 E10 F1500 ; prime line
G1 X5.4 Y100 F5000
G1 X5.4 Y10 E20 F1500 ; second prime line
G92 E0
G1 Z2.0 F3000`;

const MARLIN_START_ABL = MARLIN_START.replace(
  'G28 ; home all axes',
  'G28 ; home all axes\nG29 ; auto bed levelling (remove if you have no probe)',
);

const MARLIN_END = `G91 ; relative positioning
G1 E-2 F2700 ; retract
G1 Z10 F3000 ; lift nozzle
G90 ; absolute positioning
G1 X0 Y{bed_y} F3000 ; present the print
M106 S0 ; fan off
M104 S0 ; nozzle off
M140 S0 ; bed off
M84 X Y E ; motors off`;

const KLIPPER_START = `; Klipper: this calls the PRINT_START macro from your printer.cfg.
; Rename it (e.g. START_PRINT) if your config uses a different name.
PRINT_START BED={first_layer_bed_temp} EXTRUDER={first_layer_nozzle_temp}
M190 S{first_layer_bed_temp} ; make sure temperatures are reached
M109 S{first_layer_nozzle_temp}
G90
M82
G92 E0`;

const KLIPPER_END = `PRINT_END`;

const CREALITY_K1_START = `M140 S{first_layer_bed_temp}
M104 S{first_layer_nozzle_temp}
START_PRINT EXTRUDER_TEMP={first_layer_nozzle_temp} BED_TEMP={first_layer_bed_temp}
G90
M82
G92 E0`;

const CREALITY_K1_END = `END_PRINT`;

const PRUSA_START = `M862.3 P "{printer_model}" ; printer model check
G90 ; absolute positioning
M83 ; set extruder to relative before priming
M140 S{first_layer_bed_temp}
M104 S{first_layer_nozzle_temp}
G28 W ; home without mesh bed levelling
M190 S{first_layer_bed_temp}
M109 S{first_layer_nozzle_temp}
G80 ; mesh bed levelling
G1 Z0.2 F720
G1 Y-3 F1000 ; go outside print area
G92 E0
G1 X60 E9 F1000 ; intro line
G1 X100 E12.5 F1000 ; intro line
G92 E0
M82 ; absolute extrusion for the rest of the file`;

const PRUSA_MK4_START = `M862.3 P "{printer_model}" ; printer model check
G90 ; absolute positioning
M83
M140 S{first_layer_bed_temp}
M104 T0 S170 ; preheat nozzle to probing temperature
G28 ; home
M190 S{first_layer_bed_temp}
G29 ; mesh bed levelling
M109 S{first_layer_nozzle_temp}
G1 Z0.2 F720
G1 X0 Y-4 F2400 ; purge position
G92 E0
G1 X60 E9 F1000 ; purge line
G1 X100 E12.5 F1000
G92 E0
M82 ; absolute extrusion for the rest of the file`;

const PRUSA_END = `G91
G1 E-1 F2100 ; retract
G1 Z10 F720 ; lift
G90
G1 X0 Y200 F3600 ; present the print
M106 S0
M104 S0
M140 S0
M84`;

const DELTA_START = `G90
M82
M140 S{first_layer_bed_temp}
M104 S{first_layer_nozzle_temp}
G28 ; home all towers
M190 S{first_layer_bed_temp}
M109 S{first_layer_nozzle_temp}
G92 E0
G1 Z5 F3000
; the skirt primes the nozzle on delta printers`;

const DELTA_END = `G91
G1 E-2 F2700
G1 Z10 F3000
G90
G28 ; home towers
M106 S0
M104 S0
M140 S0
M84`;

const BAMBU_NOTE =
  'Bambu Lab firmware prefers .gcode.3mf files sent from Bambu Studio. A plain .gcode file ' +
  'can be printed from the SD card on most models, but features like the AMS and ' +
  'automatic calibration are not driven from this file.';

const BAMBU_START = `; Simplified start sequence for Bambu Lab printers
M140 S{first_layer_bed_temp}
M104 S{first_layer_nozzle_temp}
G28 ; home
M190 S{first_layer_bed_temp}
M109 S{first_layer_nozzle_temp}
G90
M82
G92 E0
G1 Z2 F1200
G1 X18 Y1 Z0.3 F18000
G1 X240 E12 F3000 ; purge line along the front
G92 E0
G1 Z2 F1200`;

const BAMBU_END = `G91
G1 E-1 F1800
G1 Z10 F1200
G90
G1 X128 Y250 F12000
M106 S0
M104 S0
M140 S0
M84`;

interface PrinterSpec
  extends Omit<
    PrinterProfile,
    | 'bedShape'
    | 'originCenter'
    | 'heatedBed'
    | 'filamentDiameter'
    | 'nozzleDiameter'
    | 'maxBedTemp'
    | 'maxNozzleTemp'
    | 'flavor'
    | 'startGcode'
    | 'endGcode'
    | 'retractSpeed'
    | 'acceleration'
  > {
  bedShape?: PrinterProfile['bedShape'];
  originCenter?: boolean;
  heatedBed?: boolean;
  filamentDiameter?: number;
  nozzleDiameter?: number;
  maxBedTemp?: number;
  maxNozzleTemp?: number;
  flavor?: PrinterProfile['flavor'];
  startGcode?: string;
  endGcode?: string;
  retractSpeed?: number;
  acceleration?: number;
}

function printer(spec: PrinterSpec): PrinterProfile {
  return {
    bedShape: 'rectangle',
    originCenter: false,
    heatedBed: true,
    filamentDiameter: 1.75,
    nozzleDiameter: 0.4,
    maxBedTemp: 100,
    maxNozzleTemp: 260,
    flavor: 'marlin',
    startGcode: MARLIN_START,
    endGcode: MARLIN_END,
    retractSpeed: 40,
    acceleration: 1000,
    ...spec,
  };
}

export const BUILTIN_PRINTERS: PrinterProfile[] = [
  // ── Generic ───────────────────────────────────────────────────────────
  printer({
    id: 'generic-220',
    manufacturer: 'Generic',
    name: 'Generic FDM 220×220 (Marlin)',
    bedX: 220, bedY: 220, maxZ: 250,
    retractLength: 5, maxPrintSpeed: 80,
  }),
  printer({
    id: 'generic-klipper-300',
    manufacturer: 'Generic',
    name: 'Generic Klipper 300×300',
    bedX: 300, bedY: 300, maxZ: 300,
    flavor: 'klipper', startGcode: KLIPPER_START, endGcode: KLIPPER_END,
    retractLength: 0.8, maxPrintSpeed: 250, acceleration: 5000, maxNozzleTemp: 300, maxBedTemp: 110,
  }),
  printer({
    id: 'generic-delta',
    manufacturer: 'Generic',
    name: 'Generic Delta Ø200',
    bedX: 200, bedY: 200, maxZ: 250, bedShape: 'circle', originCenter: true,
    startGcode: DELTA_START, endGcode: DELTA_END,
    retractLength: 5, maxPrintSpeed: 150, acceleration: 3000,
  }),

  // ── Creality ──────────────────────────────────────────────────────────
  printer({
    id: 'creality-ender3',
    manufacturer: 'Creality',
    name: 'Ender-3 / Ender-3 Pro',
    bedX: 220, bedY: 220, maxZ: 250,
    retractLength: 5, maxPrintSpeed: 60, acceleration: 500, maxNozzleTemp: 250,
  }),
  printer({
    id: 'creality-ender3-v2',
    manufacturer: 'Creality',
    name: 'Ender-3 V2',
    bedX: 220, bedY: 220, maxZ: 250,
    retractLength: 5, maxPrintSpeed: 60, acceleration: 500, maxNozzleTemp: 250,
  }),
  printer({
    id: 'creality-ender3-s1',
    manufacturer: 'Creality',
    name: 'Ender-3 S1 / S1 Pro',
    bedX: 220, bedY: 220, maxZ: 270,
    startGcode: MARLIN_START_ABL,
    retractLength: 0.8, maxPrintSpeed: 100, acceleration: 1000, maxNozzleTemp: 300,
  }),
  printer({
    id: 'creality-ender3-v3-se',
    manufacturer: 'Creality',
    name: 'Ender-3 V3 SE',
    bedX: 220, bedY: 220, maxZ: 250,
    startGcode: MARLIN_START_ABL,
    retractLength: 0.8, maxPrintSpeed: 180, acceleration: 2500,
  }),
  printer({
    id: 'creality-ender5-s1',
    manufacturer: 'Creality',
    name: 'Ender-5 S1',
    bedX: 220, bedY: 220, maxZ: 280,
    startGcode: MARLIN_START_ABL,
    retractLength: 0.8, maxPrintSpeed: 250, acceleration: 2000, maxNozzleTemp: 300, maxBedTemp: 110,
  }),
  printer({
    id: 'creality-cr10',
    manufacturer: 'Creality',
    name: 'CR-10 / CR-10 V2',
    bedX: 300, bedY: 300, maxZ: 400,
    retractLength: 6, maxPrintSpeed: 60, acceleration: 500, maxNozzleTemp: 250,
  }),
  printer({
    id: 'creality-k1',
    manufacturer: 'Creality',
    name: 'K1 / K1C',
    bedX: 220, bedY: 220, maxZ: 250,
    flavor: 'klipper', startGcode: CREALITY_K1_START, endGcode: CREALITY_K1_END,
    retractLength: 0.8, maxPrintSpeed: 300, acceleration: 8000, maxNozzleTemp: 300, maxBedTemp: 100,
  }),
  printer({
    id: 'creality-k1-max',
    manufacturer: 'Creality',
    name: 'K1 Max',
    bedX: 300, bedY: 300, maxZ: 300,
    flavor: 'klipper', startGcode: CREALITY_K1_START, endGcode: CREALITY_K1_END,
    retractLength: 0.8, maxPrintSpeed: 300, acceleration: 8000, maxNozzleTemp: 300, maxBedTemp: 100,
  }),

  printer({
    id: 'creality-k2-plus',
    manufacturer: 'Creality',
    name: 'K2 Plus / K2 Plus Combo',
    bedX: 350, bedY: 350, maxZ: 350,
    flavor: 'klipper', startGcode: CREALITY_K1_START, endGcode: CREALITY_K1_END,
    // Rated for 600 mm/s and 30,000 mm/s²; 300 mm/s is the typical print speed.
    retractLength: 0.8, maxPrintSpeed: 600, acceleration: 20000, maxNozzleTemp: 350, maxBedTemp: 120,
    notes:
      'Uses the START_PRINT / END_PRINT macros in the K2 firmware. This file prints with a single ' +
      'filament: CFS colour changes and the heated chamber are not controlled from here, so load the ' +
      'filament you want before starting (or feed it from the CFS slot selected on the printer).',
  }),

  // ── Prusa Research ────────────────────────────────────────────────────
  printer({
    id: 'prusa-mk3s',
    manufacturer: 'Prusa',
    name: 'Original Prusa i3 MK3S+',
    bedX: 250, bedY: 210, maxZ: 210,
    startGcode: PRUSA_START.replace('{printer_model}', 'MK3S'), endGcode: PRUSA_END,
    retractLength: 0.8, retractSpeed: 35, maxPrintSpeed: 100, acceleration: 1250, maxNozzleTemp: 300, maxBedTemp: 120,
  }),
  printer({
    id: 'prusa-mk4',
    manufacturer: 'Prusa',
    name: 'Original Prusa MK4 / MK4S',
    bedX: 250, bedY: 210, maxZ: 220,
    startGcode: PRUSA_MK4_START.replace('{printer_model}', 'MK4'), endGcode: PRUSA_END,
    retractLength: 0.7, retractSpeed: 35, maxPrintSpeed: 200, acceleration: 2500, maxNozzleTemp: 290, maxBedTemp: 120,
  }),
  printer({
    id: 'prusa-mini',
    manufacturer: 'Prusa',
    name: 'Original Prusa MINI+',
    bedX: 180, bedY: 180, maxZ: 180,
    startGcode: PRUSA_MK4_START.replace('{printer_model}', 'MINI'),
    endGcode: PRUSA_END.replace('Y200', 'Y170'),
    retractLength: 3.2, retractSpeed: 70, maxPrintSpeed: 100, acceleration: 1250, maxNozzleTemp: 280,
  }),
  printer({
    id: 'prusa-core-one',
    manufacturer: 'Prusa',
    name: 'Prusa CORE One',
    bedX: 250, bedY: 220, maxZ: 270,
    startGcode: PRUSA_MK4_START.replace('{printer_model}', 'COREONE'), endGcode: PRUSA_END,
    retractLength: 0.7, retractSpeed: 35, maxPrintSpeed: 250, acceleration: 4000, maxNozzleTemp: 290, maxBedTemp: 120,
  }),
  printer({
    id: 'prusa-xl',
    manufacturer: 'Prusa',
    name: 'Prusa XL (single tool)',
    bedX: 360, bedY: 360, maxZ: 360,
    startGcode: PRUSA_MK4_START.replace('{printer_model}', 'XL'),
    endGcode: PRUSA_END.replace('Y200', 'Y350'),
    retractLength: 0.7, retractSpeed: 35, maxPrintSpeed: 200, acceleration: 3000, maxNozzleTemp: 290, maxBedTemp: 120,
  }),

  // ── Bambu Lab ─────────────────────────────────────────────────────────
  printer({
    id: 'bambu-x1c',
    manufacturer: 'Bambu Lab',
    name: 'X1 Carbon / X1E',
    bedX: 256, bedY: 256, maxZ: 256,
    flavor: 'bambu', startGcode: BAMBU_START, endGcode: BAMBU_END, notes: BAMBU_NOTE,
    retractLength: 0.8, maxPrintSpeed: 300, acceleration: 10000, maxNozzleTemp: 300, maxBedTemp: 110,
  }),
  printer({
    id: 'bambu-p1s',
    manufacturer: 'Bambu Lab',
    name: 'P1S / P1P',
    bedX: 256, bedY: 256, maxZ: 256,
    flavor: 'bambu', startGcode: BAMBU_START, endGcode: BAMBU_END, notes: BAMBU_NOTE,
    retractLength: 0.8, maxPrintSpeed: 300, acceleration: 10000, maxNozzleTemp: 300, maxBedTemp: 100,
  }),
  printer({
    id: 'bambu-a1',
    manufacturer: 'Bambu Lab',
    name: 'A1',
    bedX: 256, bedY: 256, maxZ: 256,
    flavor: 'bambu', startGcode: BAMBU_START, endGcode: BAMBU_END, notes: BAMBU_NOTE,
    retractLength: 0.8, maxPrintSpeed: 300, acceleration: 10000, maxNozzleTemp: 300, maxBedTemp: 100,
  }),
  printer({
    id: 'bambu-a1-mini',
    manufacturer: 'Bambu Lab',
    name: 'A1 mini',
    bedX: 180, bedY: 180, maxZ: 180,
    flavor: 'bambu',
    startGcode: BAMBU_START.replace('X240', 'X170'),
    endGcode: BAMBU_END.replace('X128 Y250', 'X90 Y175'),
    notes: BAMBU_NOTE,
    retractLength: 0.8, maxPrintSpeed: 300, acceleration: 10000, maxNozzleTemp: 300, maxBedTemp: 80,
  }),

  // ── Anycubic ──────────────────────────────────────────────────────────
  printer({
    id: 'anycubic-kobra2',
    manufacturer: 'Anycubic',
    name: 'Kobra 2 / Kobra 2 Neo',
    bedX: 220, bedY: 220, maxZ: 250,
    startGcode: MARLIN_START_ABL,
    retractLength: 0.8, maxPrintSpeed: 250, acceleration: 2500,
  }),
  printer({
    id: 'anycubic-kobra2-max',
    manufacturer: 'Anycubic',
    name: 'Kobra 2 Max',
    bedX: 420, bedY: 420, maxZ: 500,
    startGcode: MARLIN_START_ABL,
    retractLength: 0.8, maxPrintSpeed: 250, acceleration: 2000,
  }),
  printer({
    id: 'anycubic-vyper',
    manufacturer: 'Anycubic',
    name: 'Vyper',
    bedX: 245, bedY: 245, maxZ: 260,
    startGcode: MARLIN_START_ABL,
    retractLength: 6, maxPrintSpeed: 80, acceleration: 1000,
  }),

  // ── Elegoo ────────────────────────────────────────────────────────────
  printer({
    id: 'elegoo-neptune4',
    manufacturer: 'Elegoo',
    name: 'Neptune 4 / 4 Pro',
    bedX: 225, bedY: 225, maxZ: 265,
    flavor: 'klipper', startGcode: KLIPPER_START, endGcode: KLIPPER_END,
    retractLength: 0.8, maxPrintSpeed: 250, acceleration: 5000, maxNozzleTemp: 300, maxBedTemp: 110,
  }),
  printer({
    id: 'elegoo-neptune4-max',
    manufacturer: 'Elegoo',
    name: 'Neptune 4 Max',
    bedX: 420, bedY: 420, maxZ: 480,
    flavor: 'klipper', startGcode: KLIPPER_START, endGcode: KLIPPER_END,
    retractLength: 0.8, maxPrintSpeed: 200, acceleration: 3000, maxNozzleTemp: 300, maxBedTemp: 110,
  }),
  printer({
    id: 'elegoo-neptune3-pro',
    manufacturer: 'Elegoo',
    name: 'Neptune 3 Pro',
    bedX: 225, bedY: 225, maxZ: 280,
    startGcode: MARLIN_START_ABL,
    retractLength: 0.8, maxPrintSpeed: 100, acceleration: 1000,
  }),

  // ── Voron ─────────────────────────────────────────────────────────────
  printer({
    id: 'voron-2.4-350',
    manufacturer: 'Voron',
    name: 'Voron 2.4 (350 mm)',
    bedX: 350, bedY: 350, maxZ: 340,
    flavor: 'klipper', startGcode: KLIPPER_START, endGcode: KLIPPER_END,
    retractLength: 0.5, maxPrintSpeed: 300, acceleration: 5000, maxNozzleTemp: 300, maxBedTemp: 120,
  }),
  printer({
    id: 'voron-trident-300',
    manufacturer: 'Voron',
    name: 'Voron Trident (300 mm)',
    bedX: 300, bedY: 300, maxZ: 250,
    flavor: 'klipper', startGcode: KLIPPER_START, endGcode: KLIPPER_END,
    retractLength: 0.5, maxPrintSpeed: 300, acceleration: 5000, maxNozzleTemp: 300, maxBedTemp: 120,
  }),
  printer({
    id: 'voron-0.2',
    manufacturer: 'Voron',
    name: 'Voron 0.2',
    bedX: 120, bedY: 120, maxZ: 120,
    flavor: 'klipper', startGcode: KLIPPER_START, endGcode: KLIPPER_END,
    retractLength: 0.5, maxPrintSpeed: 250, acceleration: 5000, maxNozzleTemp: 300, maxBedTemp: 120,
  }),

  // ── Others ────────────────────────────────────────────────────────────
  printer({
    id: 'artillery-sidewinder-x2',
    manufacturer: 'Artillery',
    name: 'Sidewinder X2',
    bedX: 300, bedY: 300, maxZ: 400,
    startGcode: MARLIN_START_ABL,
    retractLength: 1, maxPrintSpeed: 100, acceleration: 1000,
  }),
  printer({
    id: 'sovol-sv06',
    manufacturer: 'Sovol',
    name: 'SV06',
    bedX: 220, bedY: 220, maxZ: 250,
    startGcode: MARLIN_START_ABL,
    retractLength: 0.8, maxPrintSpeed: 150, acceleration: 1500, maxNozzleTemp: 300,
  }),
  printer({
    id: 'qidi-x-plus3',
    manufacturer: 'QIDI',
    name: 'X-Plus 3',
    bedX: 280, bedY: 280, maxZ: 270,
    flavor: 'klipper', startGcode: KLIPPER_START, endGcode: KLIPPER_END,
    retractLength: 0.8, maxPrintSpeed: 300, acceleration: 10000, maxNozzleTemp: 350, maxBedTemp: 120,
  }),
  printer({
    id: 'flashforge-adventurer5m',
    manufacturer: 'FlashForge',
    name: 'Adventurer 5M / 5M Pro',
    bedX: 220, bedY: 220, maxZ: 220,
    flavor: 'klipper', startGcode: KLIPPER_START.replace(/PRINT_START[^\n]*/, 'START_PRINT'),
    endGcode: 'END_PRINT',
    retractLength: 0.8, maxPrintSpeed: 300, acceleration: 10000, maxNozzleTemp: 280, maxBedTemp: 110,
  }),
  printer({
    id: 'ultimaker-s5',
    manufacturer: 'UltiMaker',
    name: 'UltiMaker S5 (2.85 mm)',
    bedX: 330, bedY: 240, maxZ: 300,
    filamentDiameter: 2.85,
    retractLength: 6.5, retractSpeed: 25, maxPrintSpeed: 100, acceleration: 3000, maxNozzleTemp: 280, maxBedTemp: 140,
    notes: 'UltiMaker printers prefer .ufp files from Cura. Plain G-code prints from USB when the firmware is set to accept it.',
  }),
  printer({
    id: 'flsun-q5',
    manufacturer: 'FLSUN',
    name: 'Q5 (delta)',
    bedX: 200, bedY: 200, maxZ: 200, bedShape: 'circle', originCenter: true,
    startGcode: DELTA_START, endGcode: DELTA_END,
    retractLength: 5, maxPrintSpeed: 150, acceleration: 3000,
  }),
];

export const DEFAULT_PRINTER_ID = 'creality-ender3-v2';

export function blankCustomPrinter(): PrinterProfile {
  return {
    ...BUILTIN_PRINTERS[0],
    id: `custom-${Date.now().toString(36)}`,
    manufacturer: 'My printers',
    name: 'My custom printer',
    custom: true,
  };
}
