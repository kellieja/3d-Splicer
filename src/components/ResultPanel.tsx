import type { SliceResult } from '../types';
import { formatDuration } from '../slicer/gcode';

interface Props {
  result: SliceResult;
  onDownload: () => void;
}

export function ResultPanel({ result, onDownload }: Props) {
  const s = result.stats;
  return (
    <div className="result">
      <dl className="stats">
        <div><dt>Print time</dt><dd>{formatDuration(s.estimatedTime)}</dd></div>
        <div><dt>Filament</dt><dd>{s.filamentLength.toFixed(2)} m</dd></div>
        <div><dt>Weight</dt><dd>{s.filamentWeight.toFixed(1)} g</dd></div>
        <div><dt>Cost</dt><dd>{s.cost.toFixed(2)}</dd></div>
        <div><dt>Layers</dt><dd>{s.layerCount}</dd></div>
        <div><dt>Height</dt><dd>{s.height.toFixed(2)} mm</dd></div>
      </dl>
      <button className="btn primary wide" onClick={onDownload}>Download G-code</button>
      <p className="muted small">Print time is an estimate. Your printer may be faster or slower.</p>
    </div>
  );
}
