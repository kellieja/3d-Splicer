/// <reference lib="webworker" />
import { slice, type SliceRequest } from '../slicer';
import type { SliceResult } from '../types';

/** One job can slice several plates (for models split into parts). */
export interface PlatesRequest extends Omit<SliceRequest, 'positions'> {
  plates: Float32Array[];
}

export type WorkerMessage =
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'done'; results: SliceResult[] }
  | { type: 'error'; message: string };

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (ev: MessageEvent<PlatesRequest>) => {
  try {
    const { plates, ...rest } = ev.data;
    const results: SliceResult[] = [];
    let last = 0;
    plates.forEach((positions, i) => {
      const prefix = plates.length > 1 ? `Plate ${i + 1}/${plates.length}: ` : '';
      results.push(
        slice({ ...rest, positions }, (stage, fraction) => {
          const now = performance.now();
          // Throttle progress messages to keep the UI responsive.
          if (fraction === 0 || fraction === 1 || now - last > 100) {
            last = now;
            const overall = (i + fraction) / plates.length;
            self.postMessage({ type: 'progress', stage: prefix + stage, fraction: overall } satisfies WorkerMessage);
          }
        }),
      );
    });
    const transfer = results.flatMap((r) => [
      r.preview.positions.buffer,
      r.preview.colors.buffer,
      r.preview.layerEnds.buffer,
      r.preview.layerZ.buffer,
    ]);
    self.postMessage({ type: 'done', results } satisfies WorkerMessage, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerMessage);
  }
};
