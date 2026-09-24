import type { FilamentProfile } from '../types';
import { NumberField, Section, SelectField } from './fields';

interface Props {
  filaments: FilamentProfile[];
  filament: FilamentProfile;
  onSelect: (id: string) => void;
  /** Called with edits to the selected filament (kept as overrides). */
  onChange: (f: FilamentProfile) => void;
  onReset: () => void;
  modified: boolean;
}

export function FilamentPanel({ filaments, filament: f, onSelect, onChange, onReset, modified }: Props) {
  const set = <K extends keyof FilamentProfile>(k: K, v: FilamentProfile[K]) => onChange({ ...f, [k]: v });
  return (
    <Section title="2. Filament" badge={`${f.nozzleTemp}° / ${f.bedTemp}°`}>
      <SelectField
        label="Filament"
        value={f.id}
        onChange={onSelect}
        options={filaments.map((x) => ({ value: x.id, label: x.name, group: x.material }))}
      />
      <div className="grid2">
        <NumberField label="Nozzle temp" unit="°C" value={f.nozzleTemp} min={150} max={450} onChange={(v) => set('nozzleTemp', v)} />
        <NumberField label="First layer temp" unit="°C" value={f.firstLayerNozzleTemp} min={150} max={450} onChange={(v) => set('firstLayerNozzleTemp', v)} />
        <NumberField label="Bed temp" unit="°C" value={f.bedTemp} min={0} max={150} onChange={(v) => set('bedTemp', v)} />
        <NumberField label="Cooling fan" unit="%" value={f.fanSpeed} min={0} max={100} onChange={(v) => set('fanSpeed', v)} />
        <NumberField label="Flow" unit="%" value={Math.round(f.flow * 100)} min={50} max={150} onChange={(v) => set('flow', v / 100)} />
        <NumberField label="Price per kg" value={f.costPerKg} min={0} max={1000} onChange={(v) => set('costPerKg', v)} />
      </div>
      {modified && (
        <button className="btn ghost small" onClick={onReset}>Reset to defaults</button>
      )}
    </Section>
  );
}
