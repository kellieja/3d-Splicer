import type { Cuts, DowelOptions, SplitResult } from '../slicer/split';
import { NumberField, Section, Toggle } from './fields';

interface Props {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  /** True when the model doesn't fit the printer in one piece. */
  tooBig: boolean;
  /** Cut positions measured from the model's minimum corner. */
  cuts: Cuts;
  manual: boolean;
  onCutsChange: (c: Cuts) => void;
  onAuto: () => void;
  size: [number, number, number];
  dowels: DowelOptions;
  onDowelsChange: (d: DowelOptions) => void;
  autoOrient: boolean;
  onAutoOrientChange: (v: boolean) => void;
  supports: boolean;
  onSupportsChange: (v: boolean) => void;
  result: SplitResult | null;
  busy: boolean;
  error: string | null;
}

const AXES = ['X', 'Y', 'Z'] as const;
const AXIS_HINT = ['left → right', 'front → back', 'bottom → top'];

export function SplitPanel(p: Props) {
  const r = p.result;

  const setAxis = (a: number, list: number[]) => {
    const next = p.cuts.map((l) => [...l]) as Cuts;
    next[a] = list;
    p.onCutsChange(next);
  };

  /** Re-spaces the cuts on one axis evenly for the given number of parts. */
  const setCount = (a: number, parts: number) => {
    const n = Math.max(1, Math.min(20, parts));
    setAxis(a, Array.from({ length: n - 1 }, (_, k) => +(((k + 1) * p.size[a]) / n).toFixed(1)));
  };

  const badge = p.enabled && r ? `${r.parts.length} parts · ${r.plates.length} plate${r.plates.length === 1 ? '' : 's'}` : undefined;

  return (
    <Section title="5. Split large prints" badge={badge} defaultOpen={p.tooBig || p.enabled}>
      {p.tooBig && !p.enabled && (
        <p className="note small">
          This model is too big for the printer in one piece. Turn on splitting to cut it into parts
          joined with dowel pins, laid out over as few plates as possible.
        </p>
      )}
      <Toggle label="Split the model into parts" checked={p.enabled} onChange={p.onEnabledChange} />

      {p.enabled && (
        <>
          <div className="split-summary">
            {p.busy ? (
              <span className="muted small">Working out the parts…</span>
            ) : r ? (
              <>
                <div><strong>{r.parts.length}</strong><span>parts</span></div>
                <div><strong>{r.dowels}</strong><span>dowel pins</span></div>
                <div><strong>{r.plates.length}</strong><span>plate{r.plates.length === 1 ? '' : 's'}</span></div>
              </>
            ) : null}
          </div>
          {p.error && <p className="error small">Splitting failed: {p.error}</p>}
          {r?.warnings.map((w) => <p key={w} className="warning small">{w}</p>)}

          <div className="field">
            <div className="row between">
              <label>Cuts {p.manual ? '(custom)' : '(automatic)'}</label>
              {p.manual && <button className="btn ghost small" onClick={p.onAuto}>Back to automatic</button>}
            </div>
            <p className="muted small">Scale the model in step 3 and the number of parts and plates updates here.</p>
          </div>
          {AXES.map((axis, a) => (
            <div key={axis} className="cut-axis">
              <div className="row between">
                <span className="small"><strong>{axis}</strong> <span className="muted">({AXIS_HINT[a]})</span></span>
                <div className="stepper">
                  <button className="btn ghost small" aria-label={`Fewer ${axis} parts`} onClick={() => setCount(a, p.cuts[a].length)}>−</button>
                  <span className="small">{p.cuts[a].length + 1} part{p.cuts[a].length ? 's' : ''}</span>
                  <button className="btn ghost small" aria-label={`More ${axis} parts`} onClick={() => setCount(a, p.cuts[a].length + 2)}>+</button>
                </div>
              </div>
              {p.cuts[a].length > 0 && (
                <div className="grid3">
                  {p.cuts[a].map((c, i) => (
                    <NumberField
                      key={i}
                      label={`Cut ${i + 1}`}
                      unit="mm"
                      step={1}
                      min={1}
                      max={Math.max(1, p.size[a] - 1)}
                      value={c}
                      onChange={(v) => setAxis(a, p.cuts[a].map((x, j) => (j === i ? v : x)))}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}

          <details className="subsection" open>
            <summary>Dowel joints</summary>
            <Toggle label="Add a pin and matching hole on each joint" checked={p.dowels.enabled} onChange={(v) => p.onDowelsChange({ ...p.dowels, enabled: v })} />
            {p.dowels.enabled && (
              <div className="grid3">
                <NumberField label="Pin diameter" unit="mm" step={0.5} min={2} max={30} value={p.dowels.diameter} onChange={(v) => p.onDowelsChange({ ...p.dowels, diameter: v })} />
                <NumberField label="Pin length" unit="mm" step={1} min={2} max={50} value={p.dowels.length} onChange={(v) => p.onDowelsChange({ ...p.dowels, length: v })} />
                <NumberField label="Fit gap" unit="mm" step={0.05} min={0} max={2} hint="How much bigger the hole is than the pin. Increase it if pins are too tight." value={p.dowels.tolerance} onChange={(v) => p.onDowelsChange({ ...p.dowels, tolerance: v })} />
              </div>
            )}
          </details>

          <Toggle label="Lay each part on its best side" checked={p.autoOrient} onChange={p.onAutoOrientChange} />
          <Toggle label="Add supports where still needed" checked={p.supports} onChange={p.onSupportsChange} />
        </>
      )}
    </Section>
  );
}
