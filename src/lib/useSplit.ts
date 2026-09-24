import { useEffect, useRef, useState } from 'react';
import type { SplitOptions, SplitResult } from '../slicer/split';
import type { SplitMessage, SplitRequest } from '../workers/split.worker';

export interface SplitState {
  busy: boolean;
  result: SplitResult | null;
  error: string | null;
}

/**
 * Cuts the model into parts in a Web Worker whenever the inputs change.
 * Changes are debounced so typing a number doesn't restart the work each key press.
 */
export function useSplit(positions: Float32Array | null, opts: SplitOptions | null, delay = 250): SplitState {
  const [state, setState] = useState<SplitState>({ busy: false, result: null, error: null });
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    if (!positions || !opts) {
      setState({ busy: false, result: null, error: null });
      return;
    }
    setState((s) => ({ ...s, busy: true, error: null }));
    const id = ++idRef.current;
    const timer = setTimeout(() => {
      workerRef.current?.terminate();
      const worker = new Worker(new URL('../workers/split.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (ev: MessageEvent<SplitMessage>) => {
        if (ev.data.id !== idRef.current) return;
        if (ev.data.type === 'done') setState({ busy: false, result: ev.data.result, error: null });
        else setState({ busy: false, result: null, error: ev.data.message });
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
      };
      worker.onerror = (ev) => setState({ busy: false, result: null, error: ev.message || 'Splitting failed.' });
      const copy = positions.slice();
      worker.postMessage({ ...opts, id, positions: copy } satisfies SplitRequest, [copy.buffer]);
    }, delay);
    return () => clearTimeout(timer);
  }, [positions, opts, delay]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  return state;
}
