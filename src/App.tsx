import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { strToU8, zipSync } from 'fflate';
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
import { autoCuts, DEFAULT_DOWELS, plateSoup, type Cuts, type DowelOptions, type SplitOptions } from './slicer/split';
import { loadModelFile, SUPPORTED_EXTENSIONS } from './lib/loaders';
import { loadJSON, saveJSON } from './lib/storage';
import { useSlicer } from './lib/useSlicer';
import { useSplit } from './lib/useSplit';
import { Viewer, type CutPlane, type ViewerMesh } from './components/Viewer';
import { PrinterPanel } from './components/PrinterPanel';
import { FilamentPanel } from './components/FilamentPanel';
import { TransformPanel } from './components/TransformPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { SplitPanel } from './components/SplitPanel';
import { ResultPanel } from './components/ResultPanel';
import { Section } from './components/fields';

interface LoadedModel {
  name: string;
  source: TriangleSoup;
}

type View = 'model' | 'plates' | 'layers';

const LEGEND: [keyof typeof KIND_COLORS, string][] = [
  ['outer-wall', 'Outer wall'],
  ['inner-wall', 'Inner wall'],
  ['solid-infill', 'Top / bottom'],
  ['sparse-infill', 'Infill'],
  ['support', 'Support'],
  ['skirt', 'Skirt / brim'],
];

const MODEL_COLOR = 0x3b82f6;
const ERROR_COLOR = 0xef4444;
/** Distinct colours for split parts. */
const PART_COLORS = [0x3b82f6, 0xf59e0b, 0x10b981, 0xec4899, 0x8b5cf6, 0x06b6d4, 0xef4444, 0x84cc16, 0xf97316, 0x6366f1];
/** Gap between parts in the exploded view, in mm. */
const EXPLODE = 12;

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
  const size = useMemo(() => (bounds ? boundsSize(bounds) : ([0, 0, 0] as [number, number, number])), [bounds]);
  const fitProblems = bounds ? checkFits(bounds, printer) : [];

  // ── Splitting ───────────────────────────────────────────────────────────
  const [splitOn, setSplitOn] = useState(false);
  const [manualCuts, setManualCuts] = useState<Cuts | null>(null);
  const [dowels, setDowels] = useState<DowelOptions>(() => ({ ...DEFAULT_DOWELS, ...loadJSON('dowels', {}) }));
  const [autoOrient, setAutoOrient] = useState(() => loadJSON('autoOrient', true));
  useEffect(() => saveJSON('dowels', dowels), [dowels]);
  useEffect(() => saveJSON('autoOrient', autoOrient), [autoOrient]);

  const cuts = useMemo(
    () => manualCuts ?? autoCuts(size, printer, settings, dowels),
    [manualCuts, size, printer, settings, dowels],
  );
  const splitOpts = useMemo<SplitOptions | null>(
    () => (splitOn && placed ? { cuts, dowels, autoOrient, printer, settings } : null),
    [splitOn, placed, cuts, dowels, autoOrient, printer, settings],
  );
  const split = useSplit(splitOn ? placed : null, splitOpts);
  const splitResult = splitOn ? split.result : null;

  const openModel = useCallback((name: string, source: TriangleSoup) => {
    setModel({ name, source });
    setTransform(IDENTITY_TRANSFORM);
    setManualCuts(null);
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
    setManualCuts(null);
  };

  const enableSplit = (v: boolean) => {
    setSplitOn(v);
    // Split parts are laid on a cut face, but a few overhangs usually remain.
    if (v && !settings.supports) setSettings((s) => ({ ...s, supports: true }));
  };

  // ── Slicing ─────────────────────────────────────────────────────────────
  const slicer = useSlicer();
  const [view, setView] = useState<View>('model');
  const [plateIndex, setPlateIndex] = useState(0);
  const [layer, setLayer] = useState(0);
  const { clear } = slicer;

  const plates = useMemo(() => {
    if (!placed) return [];
    if (splitOn) return splitResult ? splitResult.plates.map(plateSoup) : [];
    return [placed];
  }, [placed, splitOn, splitResult]);
  const plateCount = plates.length;

  // Any change to the inputs makes the previous result stale.
  useEffect(() => {
    clear();
    setView((v) => (v === 'layers' ? (splitOn ? 'plates' : 'model') : v === 'plates' && !splitOn ? 'model' : v));
  }, [plates, settings, filament, printer, clear, splitOn]);

  useEffect(() => {
    if (plateIndex >= Math.max(1, plateCount)) setPlateIndex(0);
  }, [plateCount, plateIndex]);

  const results = slicer.results;
  const current = results?.[plateIndex] ?? null;

  useEffect(() => {
    if (results) setView('layers');
  }, [results]);
  useEffect(() => {
    if (current) setLayer(current.stats.layerCount - 1);
  }, [current]);

  const canSlice = !!model && plateCount > 0 && !(splitOn && split.busy);
  const startSlice = () => {
    if (!canSlice || !model) return;
    slicer.run({ plates, printer, filament, settings, modelName: model.name });
  };

  const download = () => {
    if (!results || !model) return;
    const base = model.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_') || 'model';
    const stem = `${base}_${printer.id}_${filament.id}`;
    let blob: Blob, name: string;
    if (results.length === 1) {
      blob = new Blob([results[0].gcode], { type: 'text/x-gcode' });
      name = `${stem}.gcode`;
    } else {
      const files: Record<string, Uint8Array> = {};
      results.forEach((r, i) => (files[`${stem}_plate${i + 1}of${results.length}.gcode`] = strToU8(r.gcode)));
      const zipped = zipSync(files, { level: 6 });
      blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
      name = `${stem}_${results.length}-plates.zip`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ── What the 3D view shows ──────────────────────────────────────────────
  const meshes = useMemo<ViewerMesh[]>(() => {
    if (!placed) return [];
    if (!splitOn) return [{ positions: placed, color: fitProblems.length ? ERROR_COLOR : MODEL_COLOR }];
    if (!splitResult) return [{ positions: placed, color: MODEL_COLOR }];
    const color = (i: number) => (splitResult.parts[i].fits ? PART_COLORS[i % PART_COLORS.length] : ERROR_COLOR);
    if (view === 'plates' || view === 'layers') {
      const plate = splitResult.plates[plateIndex] ?? splitResult.plates[0];
      return plate ? plate.parts.map((p) => ({ positions: p.positions, color: color(p.part) })) : [];
    }
    // Exploded view: pull the parts apart a little so the cuts are visible.
    const counts = splitResult.cuts.map((c) => c.length + 1);
    return splitResult.parts.map((p, i) => {
      const off = [0, 1].map((a) => (p.cell[a] - (counts[a] - 1) / 2) * EXPLODE);
      const out = new Float32Array(p.positions.length);
      for (let k = 0; k < out.length; k += 3) {
        out[k] = p.positions[k] + off[0];
        out[k + 1] = p.positions[k + 1] + off[1];
        out[k + 2] = p.positions[k + 2] + p.cell[2] * EXPLODE; // keep the bottom row on the bed
      }
      return { positions: out, color: color(i) };
    });
  }, [placed, splitOn, splitResult, view, plateIndex, fitProblems.length]);

  const planes = useMemo<CutPlane[]>(() => {
    if (!splitResult || !bounds || view !== 'model') return [];
    const counts = splitResult.cuts.map((c) => c.length + 1);
    const lift = ((counts[2] - 1) / 2) * EXPLODE;
    const min = [0, 1, 2].map((a) => bounds.min[a] - ((counts[a] - 1) / 2) * EXPLODE) as [number, number, number];
    const max = [0, 1, 2].map((a) => bounds.max[a] + ((counts[a] - 1) / 2) * EXPLODE) as [number, number, number];
    min[2] += lift;
    max[2] += lift;
    return splitResult.cuts.flatMap((list, a) =>
      list.map((value, k) => ({
        axis: a as 0 | 1 | 2,
        value: value + (k + 0.5 - (counts[a] - 1) / 2) * EXPLODE + (a === 2 ? lift : 0),
        min,
        max,
      })),
    );
  }, [splitResult, bounds, view]);

  const layerCount = current?.stats.layerCount ?? 0;
  const layerZ = current?.preview.layerZ[layer];
  const showPlatePicker = plateCount > 1 && (view === 'plates' || view === 'layers');
  const tabs: [View, string][] = splitOn ? [['model', 'Parts'], ['plates', 'Plates'], ['layers', 'Layers']] : [['model', 'Model'], ['layers', 'Layers']];
  const visibleTabs = tabs.filter(([v]) => v !== 'layers' || !!results);
  // Split parts are checked per plate; the whole model only matters when not splitting.
  const warnings = [...(splitOn ? [] : fitProblems), ...(results?.flatMap((r) => r.warnings) ?? [])].filter(
    (w, i, all) => all.indexOf(w) === i,
  );

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
            onChange={(t) => {
              setTransform(t);
              setManualCuts(null);
            }}
            size={size}
            uniform={uniform}
            onUniformChange={setUniform}
            onFit={fitToBed}
            onReset={() => {
              setTransform(IDENTITY_TRANSFORM);
              setManualCuts(null);
            }}
          />

          <SettingsPanel settings={settings} onChange={setSettings} />

          <SplitPanel
            enabled={splitOn}
            onEnabledChange={enableSplit}
            tooBig={fitProblems.length > 0}
            cuts={cuts}
            manual={!!manualCuts}
            onCutsChange={setManualCuts}
            onAuto={() => setManualCuts(null)}
            size={size}
            dowels={dowels}
            onDowelsChange={setDowels}
            autoOrient={autoOrient}
            onAutoOrientChange={setAutoOrient}
            supports={settings.supports}
            onSupportsChange={(v) => setSettings((s) => ({ ...s, supports: v }))}
            result={splitResult}
            busy={split.busy}
            error={splitOn ? split.error : null}
          />
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
            meshes={meshes}
            planes={planes}
            preview={view === 'layers' ? current?.preview ?? null : null}
            mode={view === 'layers' ? 'preview' : 'model'}
            layer={layer}
            frameKey={`${model?.name}|${view}|${plateIndex}|${splitOn && !!splitResult}|${transform.scale.join()}`}
          />

          {!model && (
            <div className="empty">
              <p><strong>Drop an STL, OBJ or 3MF file here</strong></p>
              <p className="muted">or use “Open 3D model” on the left</p>
            </div>
          )}

          <div className="stage-top">
            {model && visibleTabs.length > 1 && (
              <div className="view-toggle" role="tablist">
                {visibleTabs.map(([v, label]) => (
                  <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {showPlatePicker && (
              <div className="plate-picker">
                <button aria-label="Previous plate" onClick={() => setPlateIndex((i) => (i - 1 + plateCount) % plateCount)}>‹</button>
                <span>Plate {plateIndex + 1} / {plateCount}</span>
                <button aria-label="Next plate" onClick={() => setPlateIndex((i) => (i + 1) % plateCount)}>›</button>
              </div>
            )}
          </div>

          {view === 'layers' && current && (
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
            {warnings.map((w) => (
              <p key={w} className={fitProblems.includes(w) ? 'error small' : 'warning small'}>{w}</p>
            ))}
            {!splitOn && fitProblems.length > 0 && (
              <button className="btn ghost small" onClick={() => enableSplit(true)}>Split it into parts that fit</button>
            )}
            {slicer.error && <p className="error small">Slicing failed: {slicer.error}</p>}

            {slicer.busy ? (
              <div className="progress">
                <div className="bar"><div style={{ width: `${Math.round(slicer.progress * 100)}%` }} /></div>
                <span className="small">{slicer.stage}… {Math.round(slicer.progress * 100)}%</span>
                <button className="btn ghost small" onClick={slicer.cancel}>Cancel</button>
              </div>
            ) : results ? (
              <ResultPanel results={results} plate={plateIndex} onDownload={download} />
            ) : (
              <button className="btn primary wide big" disabled={!canSlice} onClick={startSlice}>
                {!model ? 'Load a model to slice' : splitOn && split.busy ? 'Splitting…' : plateCount > 1 ? `Slice ${plateCount} plates` : 'Slice'}
              </button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
