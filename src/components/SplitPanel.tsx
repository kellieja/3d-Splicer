import type { Cuts, DowelOptions, SplitResult } from '../slicer/split';
import { NumberField, Section, Toggle } from './fields';

interface Props {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  /** True when the model doesn't fit the printer in one piece. */
  tooBig: boolean;
  /** Requested number of pieces; null = automatic (fewest that fit). */
  pieces: number | null;
  onPiecesChange: (n: number | null) => void;
  /** Fewest pieces this printer needs. */
  minimumPieces: number;
  /** Cut positions measured from the model's minimum corner. */
  cuts: Cuts;
  manual: boolean;
  onCutsChange: (c: Cuts) => void;
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
  onDownloadStl: () => void;
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

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const badge = p.enabled && r ? `${plural(r.parts.length, 'piece')} · ${plural(r.plates.length, 'plate')}` : undefined;
  const mode = p.manual ? 'custom' : p.pieces === null ? 'auto' : 'count';

  return (
    <Section title="5. Split into pieces" badge={badge} defaultOpen={p.tooBig || p.enabled}>
      {p.tooBig && !p.enabled && (
        <p className="note small">
          This model is too big for the printer in one piece. Choose <strong>Yes</strong> to cut it into pieces
          joined with dowel pins, laid flat over as few plates as possible.
        </p>
      )}

      <div className="field">
        <label>Split this model into pieces?</label>
        <div className="segmented" role="radiogroup" aria-label="Split this model into pieces">
          <button role="radio" aria-checked={!p.enabled} className={!p.enabled ? 'on' : ''} onClick={() => p.onEnabledChange(false)}>No</button>
          <button role="radio" aria-checked={p.enabled} className={p.enabled ? 'on' : ''} onClick={() => p.onEnabledChange(true)}>Yes</button>
        </div>
      </div>

      {p.enabled && (
        <>
          <div className="field">
            <label>How many pieces?</label>
            <div className="segmented" role="radiogroup" aria-label="How many pieces">
              <button role="radio" aria-checked={mode === 'auto'} className={mode === 'auto' ? 'on' : ''} onClick={() => p.onPiecesChange(null)}>
                Auto (fewest that fit)
              </button>
              <button
                role="radio"
                aria-checked={mode !== 'auto'}
                className={mode !== 'auto' ? 'on' : ''}
                onClick={() => p.onPiecesChange(Math.max(p.minimumPieces, r?.parts.length ?? p.minimumPieces))}
              >
                Choose
              </button>
            </div>
            {mode === 'count' && p.pieces !== null && (
              <div className="stepper big-stepper">
                <button className="btn ghost" aria-label="Fewer pieces" onClick={() => p.onPiecesChange(Math.max(p.minimumPieces, p.pieces! - 1))}>−</button>
                <input
                  type="number"
                  aria-label="Number of pieces"
                  min={p.minimumPieces}
                  max={200}
                  value={p.pieces}
                  onChange={(e) => {
                    const v = Math.round(+e.target.value);
                    if (Number.isFinite(v) && v >= 1) p.onPiecesChange(Math.min(200, Math.max(p.minimumPieces, v)));
                  }}
                />
                <button className="btn ghost" aria-label="More pieces" onClick={() => p.onPiecesChange(Math.min(200, p.pieces! + 1))}>+</button>
              </div>
            )}
            {mode === 'custom' && <p className="muted small">Using your own cuts (see “Adjust cuts”).</p>}
            {mode === 'count' && r && !p.busy && r.parts.length !== p.pieces && (
              <p className="muted small">
                You get {plural(r.parts.length, 'piece')}: separate bits (like an arm or a leg) become their own pieces so
                they lie flat, and empty spaces are skipped.
              </p>
            )}
            <p className="muted small">
              This printer needs at least {plural(p.minimumPieces, 'piece')} for this size. Change the size in step 3 and this updates.
            </p>
          </div>

          <div className="split-summary">
            {p.busy ? (
              <span className="muted small">Working out the pieces…</span>
            ) : r ? (
              <>
                <div><strong>{r.parts.length}</strong><span>pieces</span></div>
                <div><strong>{r.dowels}</strong><span>dowel pins</span></div>
                <div><strong>{r.plates.length}</strong><span>plate{r.plates.length === 1 ? '' : 's'}</span></div>
              </>
            ) : null}
          </div>
          {p.error && <p className="error small">Splitting failed: {p.error}</p>}
          {r?.warnings.map((w) => <p key={w} className="warning small">{w}</p>)}

          <button className="btn wide" disabled={!r || p.busy} onClick={p.onDownloadStl}>
            Download pieces as STL (.zip)
          </button>

          <details className="subsection" open={p.manual}>
            <summary>Adjust cuts</summary>
            <p className="muted small">Move cuts away from fine details, or choose how many pieces in each direction.</p>
            {AXES.map((axis, a) => (
              <div key={axis} className="cut-axis">
                <div className="row between">
                  <span className="small"><strong>{axis}</strong> <span className="muted">({AXIS_HINT[a]})</span></span>
                  <div className="stepper">
                    <button className="btn ghost small" aria-label={`Fewer ${axis} pieces`} onClick={() => setCount(a, p.cuts[a].length)}>−</button>
                    <span className="small">{plural(p.cuts[a].length + 1, 'piece')}</span>
                    <button className="btn ghost small" aria-label={`More ${axis} pieces`} onClick={() => setCount(a, p.cuts[a].length + 2)}>+</button>
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
          </details>

          <details className="subsection">
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

          <Toggle label="Lay each piece flat on its best side" checked={p.autoOrient} onChange={p.onAutoOrientChange} />
          <Toggle label="Add supports where still needed" checked={p.supports} onChange={p.onSupportsChange} />
        </>
      )}
    </Section>
  );
}
