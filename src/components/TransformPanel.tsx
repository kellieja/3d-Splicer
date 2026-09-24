import type { ModelTransform } from '../types';
import { NumberField, Section, Toggle } from './fields';

interface Props {
  transform: ModelTransform;
  onChange: (t: ModelTransform) => void;
  /** Size of the placed model in mm (after scale and rotation). */
  size: [number, number, number];
  uniform: boolean;
  onUniformChange: (v: boolean) => void;
  onFit: () => void;
  onReset: () => void;
}

const AXES = ['X', 'Y', 'Z'] as const;

export function TransformPanel({ transform: t, onChange, size, uniform, onUniformChange, onFit, onReset }: Props) {
  const setScale = (axis: number, factor: number) => {
    if (!(factor > 0)) return;
    if (uniform) {
      const ratio = factor / t.scale[axis];
      onChange({ ...t, scale: t.scale.map((s) => s * ratio) as ModelTransform['scale'] });
    } else {
      const scale = [...t.scale] as ModelTransform['scale'];
      scale[axis] = factor;
      onChange({ ...t, scale });
    }
  };

  const setSize = (axis: number, mm: number) => {
    if (!(mm > 0) || !(size[axis] > 0)) return;
    const ratio = mm / size[axis];
    if (uniform) onChange({ ...t, scale: t.scale.map((s) => s * ratio) as ModelTransform['scale'] });
    else setScale(axis, t.scale[axis] * ratio);
  };

  const rotate = (axis: number, deg: number) => {
    const rotation = [...t.rotation] as ModelTransform['rotation'];
    rotation[axis] = (((rotation[axis] + deg) % 360) + 360) % 360;
    onChange({ ...t, rotation });
  };

  return (
    <Section title="3. Scale & position" badge={`${Math.round(t.scale[0] * 100)}%`}>
      <Toggle label="Keep proportions (uniform scale)" checked={uniform} onChange={onUniformChange} />
      <div className="grid3">
        {AXES.map((a, i) => (
          <NumberField key={`s${a}`} label={`Scale ${a}`} unit="%" step={5} min={1} max={10000} value={+(t.scale[i] * 100).toFixed(2)} onChange={(v) => setScale(i, v / 100)} />
        ))}
        {AXES.map((a, i) => (
          <NumberField key={`d${a}`} label={`Size ${a}`} unit="mm" step={1} min={0.1} max={5000} value={+size[i].toFixed(2)} onChange={(v) => setSize(i, v)} />
        ))}
      </div>
      <div className="field">
        <label>Rotate</label>
        <div className="row">
          {AXES.map((a, i) => (
            <button key={a} className="btn ghost small" onClick={() => rotate(i, 90)} title={`Rotate 90° around ${a}`}>
              {a} +90°
            </button>
          ))}
        </div>
      </div>
      <div className="grid3">
        {AXES.map((a, i) => (
          <NumberField key={`r${a}`} label={`Rotation ${a}`} unit="°" step={5} min={-360} max={360} value={t.rotation[i]} onChange={(v) => { const r = [...t.rotation] as ModelTransform['rotation']; r[i] = v; onChange({ ...t, rotation: r }); }} />
        ))}
      </div>
      <div className="grid2">
        <NumberField label="Move X" unit="mm" value={t.offset[0]} onChange={(v) => onChange({ ...t, offset: [v, t.offset[1]] })} />
        <NumberField label="Move Y" unit="mm" value={t.offset[1]} onChange={(v) => onChange({ ...t, offset: [t.offset[0], v] })} />
      </div>
      <div className="row">
        <button className="btn ghost" onClick={onFit}>Scale to fit bed</button>
        <button className="btn ghost" onClick={onReset}>Reset</button>
      </div>
    </Section>
  );
}
