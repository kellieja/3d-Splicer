import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';

/**
 * UI mode shared by all panels.
 * advanced: show every setting (false = only the basics).
 * flat: sections render as plain open blocks (used by the step-by-step layout).
 */
export const UiContext = createContext({ advanced: true, flat: false });

/** Shows its children only in Advanced mode. */
export function Advanced({ children }: { children: ReactNode }) {
  return useContext(UiContext).advanced ? <>{children}</> : null;
}

/** Shows its children only in Simple mode. */
export function SimpleOnly({ children }: { children: ReactNode }) {
  return useContext(UiContext).advanced ? null : <>{children}</>;
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: string;
}

/** Number input that lets you type freely and commits valid values on change. */
export function NumberField({ label, value, onChange, min, max, step = 1, unit, hint }: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(+value.toFixed(4))), [value]);

  const commit = (raw: string) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    onChange(clamped);
  };

  return (
    <div className="field">
      <label htmlFor={id} title={hint}>{label}</label>
      <div className="input-unit">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setText(String(+value.toFixed(4)))}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; group?: string }[];
}

export function SelectField<T extends string>({ label, value, onChange, options }: SelectFieldProps<T>) {
  const id = useId();
  const groups = [...new Set(options.map((o) => o.group ?? ''))];
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {groups.map((g) =>
          g ? (
            <optgroup key={g} label={g}>
              {options.filter((o) => o.group === g).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          ) : (
            options.filter((o) => !o.group).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))
          ),
        )}
      </select>
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Section({ title, children, defaultOpen = true, badge }: { title: string; children: ReactNode; defaultOpen?: boolean; badge?: string }) {
  const { flat } = useContext(UiContext);
  if (flat) {
    // In the step-by-step layout the step already has a number, so drop "3. " etc.
    return (
      <section className="section flat">
        <div className="section-head">
          <h2>{title.replace(/^\d+\.\s*/, '')}</h2>
          {badge && <span className="badge">{badge}</span>}
        </div>
        <div className="section-body">{children}</div>
      </section>
    );
  }
  return (
    <details className="section" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {badge && <span className="badge">{badge}</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
