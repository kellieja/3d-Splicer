import { useCallback, useEffect, useRef, useState } from 'react';
import type { SliceResult } from '../types';
import type { SliceRequest } from '../slicer';
import type { WorkerMessage } from '../workers/slicer.worker';

export interface SlicerState {
  busy: boolean;
  stage: string;
  progress: number;
  result: SliceResult | null;
  error: string | null;
}

/** Runs the slicer in a Web Worker so the page stays responsive. */
export function useSlicer() {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<SlicerState>({ busy: false, stage: '', progress: 0, result: null, error: null });

  const stop = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const run = useCallback(
    (req: SliceRequest) => {
      stop();
      const worker = new Worker(new URL('../workers/slicer.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      setState({ busy: true, stage: 'Starting', progress: 0, result: null, error: null });
      worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
        const msg = ev.data;
        if (msg.type === 'progress') {
          setState((s) => ({ ...s, stage: msg.stage, progress: msg.fraction }));
        } else if (msg.type === 'done') {
          setState({ busy: false, stage: 'Done', progress: 1, result: msg.result, error: null });
          stop();
        } else {
          setState({ busy: false, stage: '', progress: 0, result: null, error: msg.message });
          stop();
        }
      };
      worker.onerror = (ev) => {
        setState({ busy: false, stage: '', progress: 0, result: null, error: ev.message || 'The slicer crashed.' });
        stop();
      };
      // Copy positions so the caller's array stays usable after transfer.
      const positions = req.positions.slice();
      worker.postMessage({ ...req, positions }, [positions.buffer]);
    },
    [stop],
  );

  const cancel = useCallback(() => {
    stop();
    setState((s) => ({ ...s, busy: false, stage: '', progress: 0 }));
  }, [stop]);

  const clear = useCallback(() => setState((s) => ({ ...s, result: null, error: null })), []);

  return { ...state, run, cancel, clear };
}
