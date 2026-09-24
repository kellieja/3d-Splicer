import type { Adhesion, InfillPattern, PrintSettings } from '../types';
import { NOZZLE_SIZES, QUALITY_PRESETS } from '../profiles/settings';
import { NumberField, Section, SelectField, Toggle } from './fields';

interface Props {
  settings: PrintSettings;
  onChange: (s: PrintSettings) => void;
}

export function SettingsPanel({ settings: s, onChange }: Props) {
  const set = <K extends keyof PrintSettings>(k: K, v: PrintSettings[K]) => onChange({ ...s, [k]: v });
  const nozzles = NOZZLE_SIZES.includes(s.nozzleDiameter) ? NOZZLE_SIZES : [...NOZZLE_SIZES, s.nozzleDiameter].sort();

  return (
    <Section title="4. Print settings" badge={`${s.layerHeight} mm · ${s.infillDensity}%`}>
      <div className="field">
        <label>Quality preset</label>
        <div className="row wrap">
          {QUALITY_PRESETS.map((p) => (
            <button key={p.id} className="btn ghost small" onClick={() => onChange({ ...s, ...p.settings })}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid2">
        <SelectField
          label="Nozzle size"
          value={String(s.nozzleDiameter)}
          onChange={(v) => set('nozzleDiameter', +v)}
          options={nozzles.map((n) => ({ value: String(n), label: `${n} mm` }))}
        />
        <NumberField label="Layer height" unit="mm" step={0.02} min={0.04} max={1.2} value={s.layerHeight} onChange={(v) => set('layerHeight', v)} />
        <NumberField label="First layer" unit="mm" step={0.02} min={0.08} max={1.2} value={s.firstLayerHeight} onChange={(v) => set('firstLayerHeight', v)} />
        <NumberField label="Walls" min={0} max={20} value={s.wallCount} onChange={(v) => set('wallCount', Math.round(v))} />
        <NumberField label="Top layers" min={0} max={50} value={s.topLayers} onChange={(v) => set('topLayers', Math.round(v))} />
        <NumberField label="Bottom layers" min={0} max={50} value={s.bottomLayers} onChange={(v) => set('bottomLayers', Math.round(v))} />
      </div>

      <div className="field">
        <label htmlFor="infill">Infill: {s.infillDensity}%</label>
        <input id="infill" type="range" min={0} max={100} step={5} value={s.infillDensity} onChange={(e) => set('infillDensity', +e.target.value)} />
      </div>
      <SelectField<InfillPattern>
        label="Infill pattern"
        value={s.infillPattern}
        onChange={(v) => set('infillPattern', v)}
        options={[
          { value: 'grid', label: 'Grid' },
          { value: 'lines', label: 'Lines' },
          { value: 'triangles', label: 'Triangles' },
        ]}
      />

      <details className="subsection">
        <summary>Speed</summary>
        <div className="grid2">
          <NumberField label="Print speed" unit="mm/s" min={5} max={1000} value={s.printSpeed} onChange={(v) => set('printSpeed', v)} />
          <NumberField label="Outer wall" unit="mm/s" min={5} max={1000} value={s.outerWallSpeed} onChange={(v) => set('outerWallSpeed', v)} />
          <NumberField label="First layer" unit="mm/s" min={5} max={200} value={s.firstLayerSpeed} onChange={(v) => set('firstLayerSpeed', v)} />
          <NumberField label="Travel" unit="mm/s" min={10} max={1000} value={s.travelSpeed} onChange={(v) => set('travelSpeed', v)} />
        </div>
      </details>

      <details className="subsection" open={s.supports}>
        <summary>Supports</summary>
        <Toggle label="Generate supports" checked={s.supports} onChange={(v) => set('supports', v)} />
        {s.supports && (
          <div className="grid2">
            <NumberField label="Overhang angle" unit="°" min={10} max={89} hint="Surfaces leaning further than this from vertical get support" value={s.supportAngle} onChange={(v) => set('supportAngle', v)} />
            <NumberField label="Density" unit="%" min={5} max={50} value={s.supportDensity} onChange={(v) => set('supportDensity', v)} />
          </div>
        )}
      </details>

      <details className="subsection">
        <summary>Bed adhesion</summary>
        <SelectField<Adhesion>
          label="Type"
          value={s.adhesion}
          onChange={(v) => set('adhesion', v)}
          options={[
            { value: 'skirt', label: 'Skirt (primes the nozzle)' },
            { value: 'brim', label: 'Brim (helps parts stick)' },
            { value: 'none', label: 'None' },
          ]}
        />
        {s.adhesion === 'brim' && <NumberField label="Brim width" unit="mm" min={1} max={30} value={s.brimWidth} onChange={(v) => set('brimWidth', v)} />}
        {s.adhesion === 'skirt' && (
          <div className="grid2">
            <NumberField label="Distance" unit="mm" min={1} max={30} value={s.skirtDistance} onChange={(v) => set('skirtDistance', v)} />
            <NumberField label="Loops" min={1} max={10} value={s.skirtLoops} onChange={(v) => set('skirtLoops', Math.round(v))} />
          </div>
        )}
      </details>

      <details className="subsection">
        <summary>Retraction</summary>
        <Toggle label="Retract on travel" checked={s.retraction} onChange={(v) => set('retraction', v)} />
        <NumberField label="Z-hop" unit="mm" step={0.1} min={0} max={5} value={s.zHop} onChange={(v) => set('zHop', v)} />
      </details>
    </Section>
  );
}
