/** G-code dialect. Only affects small details such as comments and start macros. */
export type GcodeFlavor = 'marlin' | 'klipper' | 'reprap' | 'bambu';

export type BedShape = 'rectangle' | 'circle';

export interface PrinterProfile {
  id: string;
  manufacturer: string;
  name: string;
  /** Bed width (X) in mm. For circular beds this is the diameter. */
  bedX: number;
  /** Bed depth (Y) in mm. For circular beds this is the diameter. */
  bedY: number;
  /** Maximum build height in mm. */
  maxZ: number;
  bedShape: BedShape;
  /** True when (0,0) is the middle of the bed (typical for delta printers). */
  originCenter: boolean;
  nozzleDiameter: number;
  /** 1.75 or 2.85 mm. */
  filamentDiameter: number;
  heatedBed: boolean;
  maxNozzleTemp: number;
  maxBedTemp: number;
  flavor: GcodeFlavor;
  /** Retraction distance in mm (short for direct drive, long for Bowden). */
  retractLength: number;
  /** Retraction speed in mm/s. */
  retractSpeed: number;
  /** Highest print speed the machine handles well, in mm/s. */
  maxPrintSpeed: number;
  /** Print acceleration in mm/s² (used for time estimates only). */
  acceleration: number;
  /**
   * Start G-code. Placeholders: {nozzle_temp} {bed_temp} {first_layer_nozzle_temp}
   * {first_layer_bed_temp} {bed_x} {bed_y} {max_z} {filament_diameter}
   */
  startGcode: string;
  endGcode: string;
  /** Extra information shown to the user when this printer is selected. */
  notes?: string;
  /** True for printers created by the user in the browser. */
  custom?: boolean;
}

export type FilamentMaterial =
  | 'PLA'
  | 'PETG'
  | 'ABS'
  | 'ASA'
  | 'TPU'
  | 'Nylon'
  | 'PC'
  | 'Composite'
  | 'Other';

export interface FilamentProfile {
  id: string;
  name: string;
  material: FilamentMaterial;
  nozzleTemp: number;
  firstLayerNozzleTemp: number;
  bedTemp: number;
  /** Part-cooling fan, 0–100 %. */
  fanSpeed: number;
  /** Density in g/cm³ (for weight and cost estimates). */
  density: number;
  /** Price per kilogram (any currency). */
  costPerKg: number;
  /** Extrusion multiplier, 1 = 100 %. */
  flow: number;
  /** Upper speed limit for this material, in mm/s (e.g. TPU prints slowly). */
  maxSpeed: number;
  /** Multiplier applied to the printer's retraction length (TPU likes less). */
  retractFactor: number;
  custom?: boolean;
}

export type InfillPattern = 'lines' | 'grid' | 'triangles';
export type Adhesion = 'none' | 'skirt' | 'brim';
/** Where each wall loop starts and ends (the visible "seam"). */
export type SeamPosition = 'aligned' | 'nearest' | 'rear' | 'random';

/** A height range printed with its own layer height. */
export interface LayerRange {
  /** mm from the bed */
  from: number;
  /** mm from the bed */
  to: number;
  /** layer height in mm */
  height: number;
}

export interface PrintSettings {
  layerHeight: number;
  firstLayerHeight: number;
  /** Nozzle actually installed on the printer (overrides the profile). */
  nozzleDiameter: number;
  wallCount: number;
  topLayers: number;
  bottomLayers: number;
  /** 0–100 %. */
  infillDensity: number;
  infillPattern: InfillPattern;
  /** mm/s */
  printSpeed: number;
  /** mm/s */
  outerWallSpeed: number;
  /** mm/s */
  firstLayerSpeed: number;
  /** mm/s */
  travelSpeed: number;
  supports: boolean;
  /** Overhangs steeper than this (degrees from vertical) get support. */
  supportAngle: number;
  /** 0–100 %. */
  supportDensity: number;
  adhesion: Adhesion;
  brimWidth: number;
  skirtDistance: number;
  skirtLoops: number;
  retraction: boolean;
  /** Lift the nozzle during travel moves, in mm (0 = off). */
  zHop: number;
  seam: SeamPosition;
  /** A slow, low-flow pass over the topmost surfaces to smooth them. */
  ironing: boolean;
  /** Ironing flow, % of a full layer's worth of plastic over the ironed area. */
  ironingFlow: number;
  /** mm/s */
  ironingSpeed: number;
  /** Distance between ironing lines, mm. */
  ironingSpacing: number;
  /** Thinner layers on curves and slopes, thicker on straight walls. */
  adaptiveLayers: boolean;
  /** 0 = fastest (thicker layers), 100 = finest detail. */
  adaptiveQuality: number;
  /** Your own layer heights for chosen height ranges (these win over adaptive). */
  layerRanges: LayerRange[];
}

export interface ModelTransform {
  /** Scale factors per axis (1 = 100 %). */
  scale: [number, number, number];
  /** Rotation in degrees around X, Y, Z (applied in that order). */
  rotation: [number, number, number];
  /** Offset from the bed centre in mm. */
  offset: [number, number];
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export type PathKind =
  | 'outer-wall'
  | 'inner-wall'
  | 'solid-infill'
  | 'sparse-infill'
  | 'support'
  | 'skirt'
  | 'ironing';

export interface ToolPath {
  kind: PathKind;
  /** Flat list of x,y pairs in printer coordinates (mm). */
  points: number[];
  closed: boolean;
}

export interface Layer {
  index: number;
  /** Top of the layer, in mm. */
  z: number;
  height: number;
  paths: ToolPath[];
}

export interface PrintStats {
  layerCount: number;
  /** Seconds. */
  estimatedTime: number;
  /** Metres of filament. */
  filamentLength: number;
  /** Grams. */
  filamentWeight: number;
  cost: number;
  height: number;
}

/** Compact line data for the preview renderer. */
export interface PreviewData {
  /** x,y,z for the start and end of every extrusion segment. */
  positions: Float32Array;
  /** r,g,b per vertex. */
  colors: Float32Array;
  /** Number of vertices drawn up to and including layer i. */
  layerEnds: Uint32Array;
  layerZ: Float32Array;
}

export interface SliceResult {
  gcode: string;
  stats: PrintStats;
  preview: PreviewData;
  warnings: string[];
}
