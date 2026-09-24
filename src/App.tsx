import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FilamentProfile, ModelTransform, PrintSettings, PrinterProfile } from './types';
import { BUILTIN_PRINTERS, DEFAULT_PRINTER_ID } from './profiles/printers';
import { BUILTIN_FILAMENTS, DEFAULT_FILAMENT_ID } from './profiles/filaments';
import { DEFAULT_SETTINGS } from './profiles/settings';
import {
  IDENTITY_TRANSFORM,
  boundsSize,
  checkFits,
  computeBounds,
  fitScale,
  makeCube,
  makeSampleTower,
  placeOnBed,
  type TriangleSoup,
} from './slicer/mesh';
import { KIND_COLORS } from './slicer';
import { loadModelFile, SUPPORTED_EXTENSIONS } from './lib/loaders';
import { loadJSON, saveJSON } from './lib/storage';
import { useSlicer } from './lib/useSlicer';
import { Viewer } from './components/Viewer';
import { PrinterPanel } from './components/PrinterPanel';
import { FilamentPanel } from './components/FilamentPanel';
import { TransformPanel } from './components/TransformPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { ResultPanel } from './components/ResultPanel';
import { Section } from './components/fields';

interface LoadedModel {
  name: string;
  source: TriangleSoup;
}

const LEGEND: [keyof typeof KIND_COLORS, string][] = [
  ['outer-wall', 'Outer wall'],
  ['inner-wall', 'Inner wall'],
  ['solid-infill', 'Top / bottom'],
  ['sparse-infill', 'Infill'],
  ['support', 'Support'],
  ['skirt', 'Skirt / brim'],
];

const toCss = ([r, g, b]: [number, number, number]) => `rgb(${r * 255}, ${g * 255}, ${b * 255})`;

export default function App() {
  // ── Profiles ────────────────────────────────────────────────────────────
  const [customPrinters, setCustomPrinters] = useState<PrinterProfile[]>(() => loadJSON('customPrinters', []));
  const printers = useMemo(() => [...BUILTIN_PRINTERS, ...customPrinters], [customPrinters]);
  const [printerId, setPrinterId] = useState(() => loadJSON('printerId', DEFAULT_PRINTER_ID));
  const printer = printers.find((p) => p.id === printerId) ?? printers.find((p) => p.id === DEFAULT_PRINTER_ID)!;

  const [filamentId, setFilamentId] = useState(() => loadJSON('filamentId', DEFAULT_FILAMENT_ID));
  const [filamentEdits, setFilamentEdits] = useState<Record<string, FilamentProfile>>(() => loadJSON('filamentEdits', {}));
  const baseFilament = BUILTIN_FILAMENTS.find((f) => f.id === filamentId) ?? BUILTIN_FILAMENTS[0];
  const filament = filamentEdits[baseFilament.id] ?? baseFilament;

  const [settings, setSettings] = useState<PrintSettings>(() => ({ ...DEFAULT_SETTINGS, ...loadJSON('settings', {}) }));

  useEffect(() => saveJSON('customPrinters', customPrinters), [customPrinters]);
  useEffect(() => saveJSON('printerId', printerId), [printerId]);
  useEffect(() => saveJSON('filamentId', filamentId), [filamentId]);
  useEffect(() => saveJSON('filamentEdits', filamentEdits), [filamentEdits]);
  useEffect(() => saveJSON('settings', settings), [settings]);

  const selectPrinter = (id: string) => {
    setPrinterId(id);
    const p = printers.find((x) => x.id === id);
    if (p) setSettings((s) => ({ ...s, nozzleDiameter: p.nozzleDiameter }));
  };

  // ── Model ───────────────────────────────────────────────────────────────
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [transform, setTransform] = useState<ModelTransform>(IDENTITY_TRANSFORM);
  const [uniform, setUniform] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const placed = useMemo(() => (model ? placeOnBed(model.source, transform, printer) : null), [model, transform, printer]);
  const bounds = useMemo(() => (placed ? computeBounds(placed) : null), [placed]);
  const size = bounds ? boundsSize(bounds) : ([0, 0, 0] as [number, number, number]);
  const fitProblems = bounds ? checkFits(bounds, printer) : [];

  const openModel = useCallback((name: string, source: TriangleSoup) => {
    setModel({ name, source });
    setTransform(IDENTITY_TRANSFORM);
    setLoadError(null);
  }, []);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        openModel(file.name, await loadModelFile(file));
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    },
    [openModel],
  );

  const fitToBed = () => {
    if (!model) return;
    const unscaled = boundsSize(computeBounds(placeOnBed(model.source, { ...transform, scale: [1, 1, 1] }, printer)));
    const f = fitScale(unscaled, printer);
    setTransform({ ...transform, scale: [f, f, f], offset: [0, 0] });
  };

  // ── Slicing ─────────────────────────────────────────────────────────────
  const slicer = useSlicer();
  const [mode, setMode] = useState<'model' | 'preview'>('model');
  const [layer, setLayer] = useState(0);
  const { clear } = slicer;

  // Any change to the inputs makes the previous result stale.
  useEffect(() => {
    clear();
    setMode('model');
  }, [placed, settings, filament, printer, clear]);

  useEffect(() => {
    if (slicer.result) {
      setLayer(slicer.result.stats.layerCount - 1);
      setMode('preview');
    }
  }, [slicer.result]);

  const startSlice = () => {
    if (!placed || !model) return;
    slicer.run({ positions: placed, printer, filament, settings, modelName: model.name });
  };

  const download = () => {
    if (!slicer.result || !model) return;
    const base = model.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_') || 'model';
    const blob = new Blob([slicer.result.gcode], { type: 'text/x-gcode' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}_${printer.id}_${filament.id}.gcode`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const layerCount = slicer.result?.stats.layerCount ?? 0;
  const layerZ = slicer.result?.preview.layerZ[layer];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <path d="M16 3 28 9.5v13L16 29 4 22.5v-13Z" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M4 13h24M4 17h24M4 21h24" stroke="currentColor" strokeWidth="1.5" opacity=".6" />
          </svg>
          <span>3D Splicer</span>
          <span className="tag">open-source slicer</span>
        </div>
        <a className="gh" href="https://github.com/kellieja/3d-splicer" target="_blank" rel="noreferrer">GitHub</a>
      </header>

      <main className="layout">
        <aside className="sidebar">
          <Section title="Model" badge={model ? `${size[0].toFixed(0)}×${size[1].toFixed(0)}×${size[2].toFixed(0)} mm` : undefined}>
            <button className="btn primary wide" onClick={() => fileInput.current?.click()}>
              Open 3D model…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={SUPPORTED_EXTENSIONS.join(',')}
              hidden
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <p className="muted small">STL, OBJ or 3MF. Your file never leaves your computer: slicing runs in your browser.</p>
            <div className="row">
              <button className="btn ghost small" onClick={() => openModel('calibration-cube.stl', makeCube(20))}>Sample: 20 mm cube</button>
              <button className="btn ghost small" onClick={() => openModel('sample-tower.stl', makeSampleTower())}>Sample: tower</button>
            </div>
            {model && <p className="small">Loaded <strong>{model.name}</strong> · {(model.source.length / 9).toLocaleString()} triangles</p>}
            {loadError && <p className="error small">{loadError}</p>}
          </Section>

          <PrinterPanel
            printers={printers}
            printer={printer}
            onSelect={selectPrinter}
            onSaveCustom={(p) => {
              setCustomPrinters((list) => [...list.filter((x) => x.id !== p.id), p]);
              selectPrinter(p.id);
              setSettings((s) => ({ ...s, nozzleDiameter: p.nozzleDiameter }));
            }}
            onDeleteCustom={(id) => {
              setCustomPrinters((list) => list.filter((x) => x.id !== id));
              setPrinterId(DEFAULT_PRINTER_ID);
            }}
          />

          <FilamentPanel
            filaments={BUILTIN_FILAMENTS}
            filament={filament}
            onSelect={setFilamentId}
            onChange={(f) => setFilamentEdits((e) => ({ ...e, [f.id]: f }))}
            modified={!!filamentEdits[filament.id]}
            onReset={() =>
              setFilamentEdits((e) => {
                const next = { ...e };
                delete next[filament.id];
                return next;
              })
            }
          />

          <TransformPanel
            transform={transform}
            onChange={setTransform}
            size={size}
            uniform={uniform}
            onUniformChange={setUniform}
            onFit={fitToBed}
            onReset={() => setTransform(IDENTITY_TRANSFORM)}
          />

          <SettingsPanel settings={settings} onChange={setSettings} />
        </aside>

        <section
          className={`stage${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFile(e.dataTransfer.files[0]);
          }}
        >
          <Viewer
            printer={printer}
            mesh={placed}
            preview={slicer.result?.preview ?? null}
            mode={mode}
            layer={layer}
            outOfBounds={fitProblems.length > 0}
          />

          {!model && (
            <div className="empty">
              <p><strong>Drop an STL, OBJ or 3MF file here</strong></p>
              <p className="muted">or use “Open 3D model” on the left</p>
            </div>
          )}

          {slicer.result && (
            <div className="view-toggle" role="tablist">
              <button role="tab" aria-selected={mode === 'model'} className={mode === 'model' ? 'on' : ''} onClick={() => setMode('model')}>Model</button>
              <button role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>Layers</button>
            </div>
          )}

          {mode === 'preview' && slicer.result && (
            <>
              <div className="layer-slider">
                <span className="small">Layer {layer + 1} / {layerCount}{layerZ !== undefined && ` · ${layerZ.toFixed(2)} mm`}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, layerCount - 1)}
                  value={layer}
                  onChange={(e) => setLayer(+e.target.value)}
                  aria-label="Visible layers"
                />
              </div>
              <ul className="legend">
                {LEGEND.map(([k, label]) => (
                  <li key={k}><span style={{ background: toCss(KIND_COLORS[k]) }} />{label}</li>
                ))}
              </ul>
            </>
          )}

          <div className="action-bar">
            {fitProblems.map((p) => <p key={p} className="error small">{p}</p>)}
            {slicer.result?.warnings
              .filter((w) => !fitProblems.includes(w))
              .map((w) => <p key={w} className="warning small">{w}</p>)}
            {slicer.error && <p className="error small">Slicing failed: {slicer.error}</p>}

            {slicer.busy ? (
              <div className="progress">
                <div className="bar"><div style={{ width: `${Math.round(slicer.progress * 100)}%` }} /></div>
                <span className="small">{slicer.stage}… {Math.round(slicer.progress * 100)}%</span>
                <button className="btn ghost small" onClick={slicer.cancel}>Cancel</button>
              </div>
            ) : slicer.result ? (
              <ResultPanel result={slicer.result} onDownload={download} />
            ) : (
              <button className="btn primary wide big" disabled={!model} onClick={startSlice}>
                {model ? 'Slice' : 'Load a model to slice'}
              </button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
