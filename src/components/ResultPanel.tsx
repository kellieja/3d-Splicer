import type { SliceResult } from '../types';
import { formatDuration } from '../slicer/gcode';

interface Props {
  /** One result per plate. */
  results: SliceResult[];
  /** Plate currently shown in the preview. */
  plate: number;
  onDownload: () => void;
}

export function ResultPanel({ results, plate, onDownload }: Props) {
  const multi = results.length > 1;
  const sum = (f: (r: SliceResult) => number) => results.reduce((n, r) => n + f(r), 0);
  const current = results[plate] ?? results[0];

  return (
    <div className="result">
      {multi && <p className="small"><strong>Total for {results.length} plates</strong></p>}
      <dl className="stats">
        <div><dt>Print time</dt><dd>{formatDuration(sum((r) => r.stats.estimatedTime))}</dd></div>
        <div><dt>Filament</dt><dd>{sum((r) => r.stats.filamentLength).toFixed(2)} m</dd></div>
        <div><dt>Weight</dt><dd>{sum((r) => r.stats.filamentWeight).toFixed(1)} g</dd></div>
        <div><dt>Cost</dt><dd>{sum((r) => r.stats.cost).toFixed(2)}</dd></div>
        {multi ? (
          <div><dt>Plate {plate + 1}</dt><dd>{formatDuration(current.stats.estimatedTime)}</dd></div>
        ) : (
          <div><dt>Layers</dt><dd>{current.stats.layerCount}</dd></div>
        )}
        <div><dt>Height</dt><dd>{current.stats.height.toFixed(1)} mm</dd></div>
      </dl>
      <button className="btn primary wide" onClick={onDownload}>
        {multi ? `Download ${results.length} G-code files (.zip)` : 'Download G-code'}
      </button>
      <p className="muted small">Print time is an estimate. Your printer may be faster or slower.</p>
    </div>
  );
}
