import type { FilamentProfile } from '../types';

/*
 * Generic filament profiles. Temperatures are middle-of-the-range values:
 * check the label on your spool and adjust them in the app if needed.
 */

type FilamentSpec = Omit<FilamentProfile, 'firstLayerNozzleTemp' | 'flow' | 'retractFactor' | 'maxSpeed'> &
  Partial<Pick<FilamentProfile, 'firstLayerNozzleTemp' | 'flow' | 'retractFactor' | 'maxSpeed'>>;

function filament(spec: FilamentSpec): FilamentProfile {
  return {
    firstLayerNozzleTemp: spec.nozzleTemp + 5,
    flow: 1,
    retractFactor: 1,
    maxSpeed: 300,
    ...spec,
  };
}

export const BUILTIN_FILAMENTS: FilamentProfile[] = [
  filament({ id: 'pla', name: 'Generic PLA', material: 'PLA', nozzleTemp: 210, bedTemp: 60, fanSpeed: 100, density: 1.24, costPerKg: 20 }),
  filament({ id: 'pla-plus', name: 'PLA+ / Tough PLA', material: 'PLA', nozzleTemp: 220, bedTemp: 60, fanSpeed: 100, density: 1.24, costPerKg: 22 }),
  filament({ id: 'pla-silk', name: 'Silk PLA', material: 'PLA', nozzleTemp: 215, bedTemp: 60, fanSpeed: 100, density: 1.24, costPerKg: 24, maxSpeed: 120 }),
  filament({ id: 'pla-matte', name: 'Matte PLA', material: 'PLA', nozzleTemp: 210, bedTemp: 60, fanSpeed: 100, density: 1.3, costPerKg: 22 }),
  filament({ id: 'pla-wood', name: 'Wood-fill PLA', material: 'Composite', nozzleTemp: 200, bedTemp: 60, fanSpeed: 100, density: 1.15, costPerKg: 30, maxSpeed: 100 }),
  filament({ id: 'pla-cf', name: 'PLA-CF (carbon fibre)', material: 'Composite', nozzleTemp: 220, bedTemp: 60, fanSpeed: 100, density: 1.3, costPerKg: 35, maxSpeed: 150 }),
  filament({ id: 'petg', name: 'Generic PETG', material: 'PETG', nozzleTemp: 240, bedTemp: 80, fanSpeed: 40, density: 1.27, costPerKg: 22, firstLayerNozzleTemp: 240 }),
  filament({ id: 'abs', name: 'Generic ABS', material: 'ABS', nozzleTemp: 245, bedTemp: 100, fanSpeed: 0, density: 1.04, costPerKg: 22 }),
  filament({ id: 'asa', name: 'Generic ASA', material: 'ASA', nozzleTemp: 255, bedTemp: 100, fanSpeed: 10, density: 1.07, costPerKg: 28 }),
  filament({ id: 'tpu-95a', name: 'TPU 95A (flexible)', material: 'TPU', nozzleTemp: 225, bedTemp: 50, fanSpeed: 60, density: 1.21, costPerKg: 30, maxSpeed: 25, retractFactor: 0.3, firstLayerNozzleTemp: 225 }),
  filament({ id: 'nylon', name: 'Nylon (PA)', material: 'Nylon', nozzleTemp: 260, bedTemp: 80, fanSpeed: 0, density: 1.14, costPerKg: 45, maxSpeed: 80 }),
  filament({ id: 'pc', name: 'Polycarbonate (PC)', material: 'PC', nozzleTemp: 270, bedTemp: 110, fanSpeed: 0, density: 1.2, costPerKg: 40, maxSpeed: 80 }),
];

export const DEFAULT_FILAMENT_ID = 'pla';
