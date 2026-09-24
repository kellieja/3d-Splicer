import type { PrintSettings } from '../types';

export const DEFAULT_SETTINGS: PrintSettings = {
  layerHeight: 0.2,
  firstLayerHeight: 0.24,
  nozzleDiameter: 0.4,
  wallCount: 2,
  topLayers: 4,
  bottomLayers: 3,
  infillDensity: 15,
  infillPattern: 'grid',
  printSpeed: 60,
  outerWallSpeed: 35,
  firstLayerSpeed: 20,
  travelSpeed: 150,
  supports: false,
  supportAngle: 55,
  supportDensity: 15,
  adhesion: 'skirt',
  brimWidth: 5,
  skirtDistance: 4,
  skirtLoops: 2,
  retraction: true,
  zHop: 0,
  seam: 'aligned',
  ironing: false,
  ironingFlow: 12,
  ironingSpeed: 15,
  ironingSpacing: 0.1,
  adaptiveLayers: false,
  adaptiveQuality: 50,
  layerRanges: [],
};

export interface QualityPreset {
  id: string;
  name: string;
  settings: Partial<PrintSettings>;
}

export const QUALITY_PRESETS: QualityPreset[] = [
  { id: 'draft', name: 'Draft (0.28 mm)', settings: { layerHeight: 0.28, firstLayerHeight: 0.28, wallCount: 2, topLayers: 3, bottomLayers: 3, infillDensity: 10 } },
  { id: 'standard', name: 'Standard (0.20 mm)', settings: { layerHeight: 0.2, firstLayerHeight: 0.24, wallCount: 2, topLayers: 4, bottomLayers: 3, infillDensity: 15 } },
  { id: 'fine', name: 'Fine (0.12 mm)', settings: { layerHeight: 0.12, firstLayerHeight: 0.2, wallCount: 3, topLayers: 7, bottomLayers: 5, infillDensity: 20 } },
  { id: 'strong', name: 'Strong (0.20 mm, 40 %)', settings: { layerHeight: 0.2, firstLayerHeight: 0.24, wallCount: 4, topLayers: 5, bottomLayers: 4, infillDensity: 40 } },
];

export const NOZZLE_SIZES = [0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0];
