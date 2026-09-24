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
import { computeLayerHeights } from './slicer/layers';
import { autoCuts, cutsForPieceCount, DEFAULT_DOWELS, plateSoup, type Cuts, type CutTilts, type DowelOptions, type SplitOptions } from './slicer/split';
import { toBinaryStl } from './lib/stl';
import { loadProject, PROJECT_EXTENSION, saveProject, type ProjectState } from './lib/project';
import { buildSlicerProject } from './lib/exportProject';
import { buildGuidePdf, guidePieces, renderGuidePicture } from './lib/assemblyGuide';
import { loadModelFile, SUPPORTED_EXTENSIONS } from './lib/loaders';
import { loadJSON, saveJSON } from './lib/storage';
import { useSlicer } from './lib/useSlicer';
import { useSplit } from './lib/useSplit';
import { Viewer, type BedCopy, type CutPlane, type ViewerMesh } from './components/Viewer';
import { PrinterPanel } from './components/PrinterPanel';
import { FilamentPanel } from './components/FilamentPanel';
import { TransformPanel } from './components/TransformPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { SplitPanel } from './components/SplitPanel';
import { ResultPanel } from './components/ResultPanel';
import { Section, UiContext } from './components/fields';

interface LoadedModel {
  name: string;
  source: TriangleSoup;
}

type View = 'model' | 'plates' | 'layers';

const STEPS = ['Model', 'Printer', 'Size', 'Split', 'Settings', 'Download'];

const LEGEND: [keyof typeof KIND_COLORS, string][] = [
  ['outer-wall', 'Outer wall'],
  ['inner-wall', 'Inner wall'],
  ['solid-infill', 'Top / bottom'],
  ['sparse-infill', 'Infill'],
  ['support', 'Support'],
  ['skirt', 'Skirt / brim'],
  ['ironing', 'Ironing'],
];

const MODEL_COLOR = 0x3b82f6;
const ERROR_COLOR = 0xef4444;
/** Distinct colours for split parts. */
const PART_COLORS = [0x3b82f6, 0xf59e0b, 0x10b981, 0xec4899, 0x8b5cf6, 0x06b6d4, 0xef4444, 0x84cc16, 0xf97316, 0x6366f1];
/** Gap between parts in the exploded view, in mm. */
const EXPLODE = 12;

const toCss = ([r, g, b]: [number, number, number]) => `rgb(${r * 255}, ${g * 255}, ${b * 255})`;

/** Tilts lined up with the current cuts (missing ones are straight). */
function tiltsFor(cuts: Cuts, tilts: CutTilts | null): CutTilts {
  return cuts.map((list, a) => list.map((_, i) => tilts?.[a]?.[i] ?? [0, 0])) as CutTilts;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
  // Preview of variable layer heights for the whole model.
  const layerInfo = useMemo(() => {
    if (!placed || !bounds || (!settings.adaptiveLayers && !(settings.layerRanges ?? []).length)) return null;
    const zs = computeLayerHeights(placed, bounds.max[2], settings);
    const hs = zs.map((z, i) => (i ? z - zs[i - 1] : z));
    return { count: zs.length, min: Math.min(...hs), max: Math.max(...hs) };
  }, [placed, bounds, settings]);

  // ── Splitting ───────────────────────────────────────────────────────────
  const [splitOn, setSplitOn] = useState(false);
  const [manualCuts, setManualCuts] = useState<Cuts | null>(null);
  const [pieces, setPieces] = useState<number | null>(null);
  const [tilts, setTilts] = useState<CutTilts | null>(null);
  // Tilts belong to your own cuts: going back to automatic cuts straightens them.
  const hadManualCuts = useRef(false);
  useEffect(() => {
    if (hadManualCuts.current && !manualCuts) setTilts(null);
    hadManualCuts.current = !!manualCuts;
  }, [manualCuts]);
  const [dowels, setDowels] = useState<DowelOptions>(() => ({ ...DEFAULT_DOWELS, ...loadJSON('dowels', {}) }));
  const [autoOrient, setAutoOrient] = useState(() => loadJSON('autoOrient', true));
  useEffect(() => saveJSON('dowels', dowels), [dowels]);
  useEffect(() => saveJSON('autoOrient', autoOrient), [autoOrient]);

  const minimumPieces = useMemo(
    () => autoCuts(size, printer, settings, dowels).reduce((n, l) => n * (l.length + 1), 1),
    [size, printer, settings, dowels],
  );
  const cuts = useMemo(
    () =>
      manualCuts ??
      (pieces !== null ? cutsForPieceCount(size, printer, settings, dowels, pieces).cuts : autoCuts(size, printer, settings, dowels)),
    [manualCuts, pieces, size, printer, settings, dowels],
  );
  const splitOpts = useMemo<SplitOptions | null>(
    () => (splitOn && placed ? { cuts, tilts: tiltsFor(cuts, tilts), dowels, autoOrient, printer, settings } : null),
    [splitOn, placed, cuts, tilts, dowels, autoOrient, printer, settings],
  );
  const split = useSplit(splitOn ? placed : null, splitOpts);
  const splitResult = splitOn ? split.result : null;

  const openModel = useCallback((name: string, source: TriangleSoup) => {
    setModel({ name, source });
    setTransform(IDENTITY_TRANSFORM);
    setManualCuts(null);
    setPieces(null);
    setLoadError(null);
  }, []);

  /** Restores everything from a saved .splicer project. */
  const applyProject = (source: TriangleSoup, st: ProjectState) => {
    const builtinPrinter = BUILTIN_PRINTERS.find((p) => p.id === st.printer.id);
    if (builtinPrinter && JSON.stringify(builtinPrinter) === JSON.stringify(st.printer)) {
      setPrinterId(builtinPrinter.id);
    } else {
      // A custom or edited printer comes back as one of "My printers".
      const saved: PrinterProfile = builtinPrinter
        ? { ...st.printer, id: `${st.printer.id}-saved`, manufacturer: 'My printers', name: `${st.printer.name} (from project)`, custom: true }
        : { ...st.printer, custom: true };
      setCustomPrinters((list) => [...list.filter((x) => x.id !== saved.id), saved]);
      setPrinterId(saved.id);
    }
    const base = BUILTIN_FILAMENTS.find((f) => f.id === st.filament.id) ?? BUILTIN_FILAMENTS.find((f) => f.material === st.filament.material) ?? BUILTIN_FILAMENTS[0];
    setFilamentId(base.id);
    setFilamentEdits((e) => {
      const next = { ...e };
      const f = { ...st.filament, id: base.id };
      if (JSON.stringify(f) === JSON.stringify(base)) delete next[base.id];
      else next[base.id] = f;
      return next;
    });
    setSettings({ ...DEFAULT_SETTINGS, ...st.settings });
    setModel({ name: st.modelName, source });
    setTransform(st.transform);
    setUniform(st.uniform);
    setSplitOn(st.split.enabled);
    setPieces(st.split.pieces);
    setManualCuts(st.split.manualCuts);
    setTilts(st.split.tilts ?? null);
    setDowels({ ...DEFAULT_DOWELS, ...st.split.dowels });
    setAutoOrient(st.split.autoOrient);
    setLoadError(null);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith(PROJECT_EXTENSION)) {
        const { model: source, state: st } = loadProject(new Uint8Array(await file.arrayBuffer()));
        applyProject(source, st);
      } else {
        openModel(file.name, await loadModelFile(file));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };

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
  const [step, setStep] = useState(0);
  const [advanced, setAdvanced] = useState<boolean>(() => loadJSON('advanced', false));
  useEffect(() => saveJSON('advanced', advanced), [advanced]);
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

  const downloadStl = () => {
    if (!splitResult || !model) return;
    const base = model.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_') || 'model';
    const files: Record<string, Uint8Array> = {};
    const digits = String(splitResult.parts.length).length;
    // Pieces are saved lying the way they should be printed.
    splitResult.plates.forEach((plate, pi) =>
      plate.parts.forEach((pp) => {
        const n = String(pp.part + 1).padStart(digits, '0');
        files[`${base}_piece${n}_plate${pi + 1}.stl`] = toBinaryStl(pp.positions, `${base} piece ${n}`);
      }),
    );
    saveBlob(new Blob([zipSync(files, { level: 6 }).buffer as ArrayBuffer], { type: 'application/zip' }), `${base}_${splitResult.parts.length}-pieces_stl.zip`);
  };

  const [guideError, setGuideError] = useState<string | null>(null);
  const downloadGuide = async () => {
    if (!splitResult || !model) return;
    try {
      setGuideError(null);
      const colors = splitResult.parts.map((_, i) => PART_COLORS[i % PART_COLORS.length]);
      const picture = await renderGuidePicture(splitResult, colors, EXPLODE * 2.5);
      const pdf = buildGuidePdf(
        {
          title: model.name,
          lines: [
            `${splitResult.parts.length} pieces on ${splitResult.plates.length} plate${splitResult.plates.length === 1 ? '' : 's'}, ${splitResult.dowels} dowel pins`,
            `Printer: ${printer.manufacturer} ${printer.name}. Filament: ${filament.name}.`,
            `Model size: ${size.map((v) => v.toFixed(0)).join(' x ')} mm`,
          ],
          pieces: guidePieces(splitResult, colors),
        },
        picture,
      );
      saveBlob(new Blob([pdf.buffer as ArrayBuffer], { type: 'application/pdf' }), `${baseName}_assembly-guide.pdf`);
    } catch (err) {
      setGuideError(err instanceof Error ? err.message : String(err));
    }
  };

  const baseName = (model?.name ?? 'model').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_') || 'model';

  const saveProjectFile = () => {
    if (!model) return;
    const bytes = saveProject(model.source, {
      modelName: model.name,
      printer,
      filament,
      settings,
      transform,
      uniform,
      split: { enabled: splitOn, pieces, manualCuts, tilts, dowels, autoOrient },
    });
    saveBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' }), `${baseName}${PROJECT_EXTENSION}`);
  };

  const canExport = !!placed && (!splitOn || (!!splitResult && !split.busy));
  const exportForSlicers = () => {
    if (!placed || !model || !canExport) return;
    const platesOut = splitOn && splitResult
      ? splitResult.plates.map((pl) => pl.parts.map((pp) => ({ name: `Piece ${pp.part + 1}`, positions: pp.positions })))
      : [[{ name: model.name.replace(/\.[^.]+$/, ''), positions: placed }]];
    const bytes = buildSlicerProject({ modelName: model.name, original: placed, plates: platesOut, printer, filament, settings });
    saveBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' }), `${baseName}_project_${platesOut.length}-plate${platesOut.length === 1 ? '' : 's'}.zip`);
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
    saveBlob(blob, name);
  };

  // ── What the 3D view shows ──────────────────────────────────────────────
  // In the Plates view every plate is shown side by side on one screen.
  const plateGrid = useMemo<BedCopy[] | undefined>(() => {
    if (!splitResult || view !== 'plates') return undefined;
    const n = splitResult.plates.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    // Clear space between plates (and room for each plate's label in front).
    const sx = printer.bedX * 1.35 + 20;
    const sy = printer.bedY * 1.45 + 40;
    return splitResult.plates.map((_, i) => ({
      x: (i % cols) * sx,
      y: (rows - 1 - Math.floor(i / cols)) * sy,
      label: `Plate ${i + 1}`,
    }));
  }, [splitResult, view, printer]);

  const meshes = useMemo<ViewerMesh[]>(() => {
    if (!placed) return [];
    if (!splitOn) return [{ positions: placed, color: fitProblems.length ? ERROR_COLOR : MODEL_COLOR }];
    if (!splitResult) return [{ positions: placed, color: MODEL_COLOR }];
    const color = (i: number) => (splitResult.parts[i].fits ? PART_COLORS[i % PART_COLORS.length] : ERROR_COLOR);
    if (view === 'plates' && plateGrid) {
      return splitResult.plates.flatMap((plate, i) =>
        plate.parts.map((p) => {
          const { x, y } = plateGrid[i];
          const out = new Float32Array(p.positions.length);
          for (let k = 0; k < out.length; k += 3) {
            out[k] = p.positions[k] + x;
            out[k + 1] = p.positions[k + 1] + y;
            out[k + 2] = p.positions[k + 2];
          }
          return { positions: out, color: color(p.part) };
        }),
      );
    }
    if (view === 'layers') {
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
  }, [placed, splitOn, splitResult, view, plateIndex, plateGrid, fitProblems.length]);

  const planes = useMemo<CutPlane[]>(() => {
    if (!splitResult || !bounds || view !== 'model') return [];
    const counts = splitResult.cuts.map((c) => c.length + 1);
    const extent = Math.max(...[0, 1, 2].map((a) => bounds.max[a] - bounds.min[a] + (counts[a] - 1) * EXPLODE));
    const seen = [0, 0, 0];
    // Move each plane into the gap between the pulled-apart pieces.
    return splitResult.planes.map((f) => {
      const k = seen[f.axis]++;
      const shift = f.axis === 2 ? (k + 0.5) * EXPLODE : (k + 0.5 - (counts[f.axis] - 1) / 2) * EXPLODE;
      const point = [...f.point] as [number, number, number];
      point[f.axis] += shift;
      if (f.axis !== 2) point[2] += ((counts[2] - 1) / 2) * EXPLODE;
      return { normal: f.n, point, size: extent * 1.15 };
    });
  }, [splitResult, bounds, view]);

  const layerCount = current?.stats.layerCount ?? 0;
  const layerZ = current?.preview.layerZ[layer];
  const showPlatePicker = plateCount > 1 && view === 'layers';
  const tabs: [View, string][] = splitOn
    ? [['model', 'Pieces'], ['plates', plateCount > 1 ? `All ${plateCount} plates` : 'Plate'], ['layers', 'Layers']]
    : [['model', 'Model'], ['layers', 'Layers']];
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
        <div className="topbar-right">
          <div className="segmented mode-switch" role="radiogroup" aria-label="Settings shown">
            <button role="radio" aria-checked={!advanced} className={!advanced ? 'on' : ''} onClick={() => setAdvanced(false)}>Simple</button>
            <button role="radio" aria-checked={advanced} className={advanced ? 'on' : ''} onClick={() => setAdvanced(true)}>Advanced</button>
          </div>
          <a className="gh" href="https://github.com/kellieja/3d-splicer" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </header>

      <main className="layout">
        <UiContext.Provider value={{ advanced, flat: true }}>
        <aside className="sidebar">
          <input
            ref={fileInput}
            type="file"
            accept={[...SUPPORTED_EXTENSIONS, PROJECT_EXTENSION].join(',')}
            hidden
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <nav className="steps" aria-label="Steps">
            {STEPS.map((title, i) => (
              <button
                key={title}
                className={`step${i === step ? ' on' : ''}${i < step ? ' done' : ''}`}
                aria-current={i === step ? 'step' : undefined}
                disabled={i > 0 && !model}
                onClick={() => setStep(i)}
              >
                <span className="step-n">{i + 1}</span>
                <span className="step-t">{title}</span>
              </button>
            ))}
          </nav>

          <div className="step-body">
            {step === 0 && (
              <Section title="Model" badge={model ? `${size[0].toFixed(0)}×${size[1].toFixed(0)}×${size[2].toFixed(0)} mm` : undefined}>
                <button className="btn primary wide big" onClick={() => fileInput.current?.click()}>
                  Open 3D model…
                </button>
                <p className="muted small">
                  STL, OBJ or 3MF, or a saved 3D Splicer project ({PROJECT_EXTENSION}). You can also drag a file onto the
                  3D view. Your file never leaves your computer.
                </p>
                <div className="row">
                  <button className="btn ghost small" onClick={() => openModel('calibration-cube.stl', makeCube(20))}>Try a 20 mm cube</button>
                  <button className="btn ghost small" onClick={() => openModel('sample-tower.stl', makeSampleTower())}>Try a tower</button>
                </div>
                {model && <p className="small">Loaded <strong>{model.name}</strong> · {(model.source.length / 9).toLocaleString()} triangles</p>}
                {loadError && <p className="error small">{loadError}</p>}
              </Section>
            )}

            {step === 1 && (
              <>
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
              </>
            )}

            {step === 2 && (
              <>
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
                {fitProblems.length > 0 && !splitOn && (
                  <p className="note small">
                    At this size the model is too big for your printer. That's fine: in the next step it can be split into
                    pieces that fit.
                  </p>
                )}
              </>
            )}

            {step === 3 && (
              <>
                {fitProblems.length === 0 && !splitOn && (
                  <p className="note small">Your model fits your printer in one piece, so you don't need to split it.</p>
                )}
                <SplitPanel
                  enabled={splitOn}
                  onEnabledChange={enableSplit}
                  tooBig={fitProblems.length > 0}
                  pieces={pieces}
                  onPiecesChange={(n) => {
                    setPieces(n);
                    setManualCuts(null);
                  }}
                  minimumPieces={minimumPieces}
                  cuts={cuts}
                  tilts={tiltsFor(cuts, tilts)}
                  onTiltsChange={(t) => {
                    if (!manualCuts) setManualCuts(cuts);
                    setTilts(t);
                  }}
                  manual={!!manualCuts}
                  onCutsChange={setManualCuts}
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
              </>
            )}

            {step === 4 && <SettingsPanel settings={settings} onChange={setSettings} layerInfo={layerInfo} />}

            {step === 5 && (
              <Section title="Slice & download">
                {!results ? (
                  <>
                    <button className="btn primary wide big" disabled={!canSlice || slicer.busy} onClick={startSlice}>
                      {slicer.busy ? 'Slicing…' : plateCount > 1 ? `Slice ${plateCount} plates` : 'Slice'}
                    </button>
                    <p className="muted small">Slicing makes the G-code file your printer reads.</p>
                  </>
                ) : (
                  <button className="btn primary wide big" onClick={download}>
                    {results.length > 1 ? `Download G-code for ${results.length} plates (.zip)` : 'Download G-code'}
                  </button>
                )}
                {splitOn && splitResult && (
                  <div className="download-list">
                    <button className="btn wide" disabled={split.busy} onClick={downloadGuide}>Assembly guide (PDF)</button>
                    <button className="btn wide" disabled={split.busy} onClick={downloadStl}>Pieces as STL files (.zip)</button>
                  </div>
                )}
                <div className="download-list">
                  <button className="btn wide" disabled={!canExport} onClick={exportForSlicers}>Project for another slicer (.zip)</button>
                  <p className="muted small">
                    Opens in Bambu Studio, OrcaSlicer, PrusaSlicer, Cura and others, with supports off so you can add your own.
                  </p>
                  <div className="row">
                    <button className="btn" disabled={!model} onClick={saveProjectFile}>Save project</button>
                    <button className="btn ghost" onClick={() => fileInput.current?.click()}>Open project…</button>
                  </div>
                  <p className="muted small">Save your model and every choice ({PROJECT_EXTENSION} file) to carry on later.</p>
                </div>
              </Section>
            )}
          </div>

          <div className="step-footer">
            <button className="btn ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>← Back</button>
            <span className="muted small">Step {step + 1} of {STEPS.length}</span>
            {step < STEPS.length - 1 ? (
              <button className="btn primary" disabled={!model} onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>Next →</button>
            ) : (
              <span />
            )}
          </div>
        </aside>
        </UiContext.Provider>

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
            frameKey={`${model?.name}|${view}|${view === 'layers' ? plateIndex : ''}|${splitOn && !!splitResult}|${transform.scale.join()}`}
            beds={plateGrid}
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
              <button
                className="btn ghost small"
                onClick={() => {
                  enableSplit(true);
                  setStep(3);
                }}
              >
                Split it into pieces that fit
              </button>
            )}
            {slicer.error && <p className="error small">Slicing failed: {slicer.error}</p>}
            {guideError && <p className="error small">Assembly guide failed: {guideError}</p>}

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
