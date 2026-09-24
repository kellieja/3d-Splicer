import { useState } from 'react';
import type { GcodeFlavor, PrinterProfile } from '../types';
import { blankCustomPrinter } from '../profiles/printers';
import { Advanced, NumberField, Section, SelectField, Toggle } from './fields';

interface Props {
  printers: PrinterProfile[];
  printer: PrinterProfile;
  onSelect: (id: string) => void;
  onSaveCustom: (p: PrinterProfile) => void;
  onDeleteCustom: (id: string) => void;
}

export function PrinterPanel({ printers, printer, onSelect, onSaveCustom, onDeleteCustom }: Props) {
  const [editing, setEditing] = useState<PrinterProfile | null>(null);

  const startCustom = (from?: PrinterProfile) => {
    const base = blankCustomPrinter();
    setEditing(from ? { ...from, id: base.id, manufacturer: base.manufacturer, name: `${from.name} (copy)`, custom: true } : base);
  };

  return (
    <Section title="1. Printer" badge={`${printer.bedX}×${printer.bedY}×${printer.maxZ}`}>
      <SelectField
        label="Printer"
        value={printer.id}
        onChange={onSelect}
        options={printers.map((p) => ({ value: p.id, label: p.name, group: p.manufacturer }))}
      />
      <p className="muted small">
        {printer.bedShape === 'circle' ? `Round bed Ø${printer.bedX} mm` : `Bed ${printer.bedX} × ${printer.bedY} mm`}, height {printer.maxZ} mm ·{' '}
        {printer.filamentDiameter} mm filament · {printer.flavor}
      </p>
      {printer.notes && <p className="note small">{printer.notes}</p>}
      <Advanced>
      <div className="row">
        <button className="btn ghost" onClick={() => startCustom(printer)}>Copy &amp; edit</button>
        <button className="btn ghost" onClick={() => startCustom()}>New custom printer</button>
        {printer.custom && (
          <>
            <button className="btn ghost" onClick={() => setEditing(printer)}>Edit</button>
            <button className="btn ghost danger" onClick={() => onDeleteCustom(printer.id)}>Delete</button>
          </>
        )}
      </div>

      {editing && (
        <PrinterEditor
          value={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={() => {
            onSaveCustom(editing);
            setEditing(null);
          }}
        />
      )}
      </Advanced>
    </Section>
  );
}

function PrinterEditor({ value: p, onChange, onSave, onCancel }: { value: PrinterProfile; onChange: (p: PrinterProfile) => void; onSave: () => void; onCancel: () => void }) {
  const set = <K extends keyof PrinterProfile>(k: K, v: PrinterProfile[K]) => onChange({ ...p, [k]: v });
  return (
    <div className="editor">
      <div className="field">
        <label htmlFor="printer-name">Name</label>
        <input id="printer-name" value={p.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <SelectField label="Bed shape" value={p.bedShape} onChange={(v) => onChange({ ...p, bedShape: v, originCenter: v === 'circle' ? true : p.originCenter })} options={[{ value: 'rectangle', label: 'Rectangle' }, { value: 'circle', label: 'Round (delta)' }]} />
      <div className="grid2">
        <NumberField label={p.bedShape === 'circle' ? 'Bed diameter' : 'Bed width (X)'} unit="mm" value={p.bedX} min={30} max={2000} onChange={(v) => onChange({ ...p, bedX: v, bedY: p.bedShape === 'circle' ? v : p.bedY })} />
        {p.bedShape === 'rectangle' && <NumberField label="Bed depth (Y)" unit="mm" value={p.bedY} min={30} max={2000} onChange={(v) => set('bedY', v)} />}
        <NumberField label="Max height (Z)" unit="mm" value={p.maxZ} min={30} max={2000} onChange={(v) => set('maxZ', v)} />
        <SelectField label="Filament" value={String(p.filamentDiameter)} onChange={(v) => set('filamentDiameter', +v)} options={[{ value: '1.75', label: '1.75 mm' }, { value: '2.85', label: '2.85 mm' }]} />
        <NumberField label="Nozzle" unit="mm" step={0.05} value={p.nozzleDiameter} min={0.1} max={2} onChange={(v) => set('nozzleDiameter', v)} />
        <SelectField<GcodeFlavor> label="Firmware" value={p.flavor} onChange={(v) => set('flavor', v)} options={[{ value: 'marlin', label: 'Marlin' }, { value: 'klipper', label: 'Klipper' }, { value: 'reprap', label: 'RepRapFirmware' }, { value: 'bambu', label: 'Bambu Lab' }]} />
        <NumberField label="Retraction" unit="mm" step={0.1} value={p.retractLength} min={0} max={15} onChange={(v) => set('retractLength', v)} />
        <NumberField label="Retract speed" unit="mm/s" value={p.retractSpeed} min={5} max={150} onChange={(v) => set('retractSpeed', v)} />
        <NumberField label="Max speed" unit="mm/s" value={p.maxPrintSpeed} min={10} max={1000} onChange={(v) => set('maxPrintSpeed', v)} />
        <NumberField label="Acceleration" unit="mm/s²" value={p.acceleration} min={100} max={50000} step={100} onChange={(v) => set('acceleration', v)} />
        <NumberField label="Max nozzle temp" unit="°C" value={p.maxNozzleTemp} min={150} max={500} onChange={(v) => set('maxNozzleTemp', v)} />
        <NumberField label="Max bed temp" unit="°C" value={p.maxBedTemp} min={0} max={150} onChange={(v) => set('maxBedTemp', v)} />
      </div>
      <Toggle label="Heated bed" checked={p.heatedBed} onChange={(v) => set('heatedBed', v)} />
      <Toggle label="Origin (0,0) at bed centre" checked={p.originCenter} onChange={(v) => set('originCenter', v)} />
      <div className="field">
        <label htmlFor="start-gcode">Start G-code</label>
        <textarea id="start-gcode" rows={8} spellCheck={false} value={p.startGcode} onChange={(e) => set('startGcode', e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="end-gcode">End G-code</label>
        <textarea id="end-gcode" rows={5} spellCheck={false} value={p.endGcode} onChange={(e) => set('endGcode', e.target.value)} />
      </div>
      <p className="muted small">
        Placeholders: <code>{'{nozzle_temp}'}</code> <code>{'{first_layer_nozzle_temp}'}</code> <code>{'{bed_temp}'}</code>{' '}
        <code>{'{first_layer_bed_temp}'}</code> <code>{'{bed_x}'}</code> <code>{'{bed_y}'}</code> <code>{'{max_z}'}</code>
      </p>
      <div className="row">
        <button className="btn primary" onClick={onSave}>Save printer</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
