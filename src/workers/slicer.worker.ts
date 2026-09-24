/// <reference lib="webworker" />
import { slice, type SliceRequest } from '../slicer';

export type WorkerMessage =
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'done'; result: ReturnType<typeof slice> }
  | { type: 'error'; message: string };

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (ev: MessageEvent<SliceRequest>) => {
  try {
    let last = 0;
    const result = slice(ev.data, (stage, fraction) => {
      const now = performance.now();
      // Throttle progress messages to keep the UI responsive.
      if (fraction === 0 || fraction === 1 || now - last > 100) {
        last = now;
        self.postMessage({ type: 'progress', stage, fraction } satisfies WorkerMessage);
      }
    });
    const p = result.preview;
    self.postMessage({ type: 'done', result } satisfies WorkerMessage, [
      p.positions.buffer,
      p.colors.buffer,
      p.layerEnds.buffer,
      p.layerZ.buffer,
    ]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerMessage);
  }
};
