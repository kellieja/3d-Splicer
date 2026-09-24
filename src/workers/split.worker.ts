/// <reference lib="webworker" />
import { splitModel, type SplitOptions, type SplitResult } from '../slicer/split';

export interface SplitRequest extends SplitOptions {
  id: number;
  positions: Float32Array;
}

export type SplitMessage =
  | { type: 'done'; id: number; result: SplitResult }
  | { type: 'error'; id: number; message: string };

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (ev: MessageEvent<SplitRequest>) => {
  const { id, positions, ...opts } = ev.data;
  try {
    const result = splitModel(positions, opts);
    const transfer = [
      ...result.parts.map((p) => p.positions.buffer),
      ...result.plates.flatMap((pl) => pl.parts.map((p) => p.positions.buffer)),
    ];
    self.postMessage({ type: 'done', id, result } satisfies SplitMessage, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) } satisfies SplitMessage);
  }
};
