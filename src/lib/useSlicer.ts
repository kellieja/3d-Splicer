import { useCallback, useEffect, useRef, useState } from 'react';
import type { SliceResult } from '../types';
import type { PlatesRequest, WorkerMessage } from '../workers/slicer.worker';

export interface SlicerState {
  busy: boolean;
  stage: string;
  progress: number;
  /** One result per plate. */
  results: SliceResult[] | null;
  error: string | null;
}

/** Runs the slicer in a Web Worker so the page stays responsive. */
export function useSlicer() {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<SlicerState>({ busy: false, stage: '', progress: 0, results: null, error: null });

  const stop = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const run = useCallback(
    (req: PlatesRequest) => {
      stop();
      const worker = new Worker(new URL('../workers/slicer.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      setState({ busy: true, stage: 'Starting', progress: 0, results: null, error: null });
      worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
        const msg = ev.data;
        if (msg.type === 'progress') {
          setState((s) => ({ ...s, stage: msg.stage, progress: msg.fraction }));
        } else if (msg.type === 'done') {
          setState({ busy: false, stage: 'Done', progress: 1, results: msg.results, error: null });
          stop();
        } else {
          setState({ busy: false, stage: '', progress: 0, results: null, error: msg.message });
          stop();
        }
      };
      worker.onerror = (ev) => {
        setState({ busy: false, stage: '', progress: 0, results: null, error: ev.message || 'The slicer crashed.' });
        stop();
      };
      // Copy the meshes so the caller's arrays stay usable after transfer.
      const plates = req.plates.map((p) => p.slice());
      worker.postMessage({ ...req, plates }, plates.map((p) => p.buffer));
    },
    [stop],
  );

  const cancel = useCallback(() => {
    stop();
    setState((s) => ({ ...s, busy: false, stage: '', progress: 0 }));
  }, [stop]);

  const clear = useCallback(() => setState((s) => ({ ...s, results: null, error: null })), []);

  return { ...state, run, cancel, clear };
}
