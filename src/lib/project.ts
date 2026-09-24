import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { FilamentProfile, ModelTransform, PrintSettings, PrinterProfile } from '../types';
import type { Cuts, CutTilts, DowelOptions } from '../slicer/split';
import type { TriangleSoup } from '../slicer/mesh';
import { toBinaryStl } from './stl';

/**
 * A saved 3D Splicer project (.splicer): a zip holding the original model
 * (model.stl) and every choice the user made (project.json).
 */
export interface ProjectState {
  modelName: string;
  printer: PrinterProfile;
  filament: FilamentProfile;
  settings: PrintSettings;
  transform: ModelTransform;
  uniform: boolean;
  split: {
    enabled: boolean;
    pieces: number | null;
    manualCuts: Cuts | null;
    /** Tilt of each of your own cuts, in degrees. */
    tilts?: CutTilts | null;
    dowels: DowelOptions;
    autoOrient: boolean;
  };
}

export const PROJECT_EXTENSION = '.splicer';
const FORMAT = '3d-splicer-project';
const VERSION = 1;

export function saveProject(model: TriangleSoup, state: ProjectState): Uint8Array {
  const json = JSON.stringify({ format: FORMAT, version: VERSION, savedAt: new Date().toISOString(), ...state }, null, 2);
  return zipSync({ 'project.json': strToU8(json), 'model.stl': toBinaryStl(model, state.modelName) }, { level: 6 });
}

export function loadProject(bytes: Uint8Array): { model: TriangleSoup; state: ProjectState } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('This is not a 3D Splicer project file.');
  }
  if (!files['project.json'] || !files['model.stl']) throw new Error('This project file is incomplete.');
  const data = JSON.parse(strFromU8(files['project.json']));
  if (data.format !== FORMAT) throw new Error('This is not a 3D Splicer project file.');
  if (data.version > VERSION) throw new Error('This project was saved by a newer version of 3D Splicer.');
  const stl = files['model.stl'];
  const geo = new STLLoader().parse(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength) as ArrayBuffer);
  const model = new Float32Array(geo.getAttribute('position').array);
  geo.dispose();
  const { format: _f, version: _v, savedAt: _s, ...state } = data;
  void _f; void _v; void _s;
  return { model, state: state as ProjectState };
}
