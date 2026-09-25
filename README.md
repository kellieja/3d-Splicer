# 3D Splicer

**A free, open-source 3D printing slicer that runs in your web browser.**
Open a model, choose your printer and filament, scale it to the size you need,
and download G-code ready to print.

**Live site:** https://kellieja.github.io/3d-splicer/ (after GitHub Pages is enabled, see [Publishing](#publishing-the-website))

- **Private:** your model is never uploaded. Everything runs on your own computer.
- **Works with most FDM printers:** 36 built-in profiles (Creality including the K1 and K2 Plus,
  Prusa, Bambu Lab, Anycubic, Elegoo, Voron, Sovol, QIDI, FlashForge, UltiMaker, Artillery,
  FLSUN delta and generic Marlin/Klipper machines), plus your own custom printers.
- **Filament profiles:** PLA, PLA+, Silk, Matte, Wood, PLA-CF, PETG, ABS, ASA, TPU, Nylon, PC.
  You can edit temperatures, fan, flow and price.
- **Scale & position:** set a percentage or an exact size in mm, keep proportions or not,
  rotate, move, or "scale to fit bed".
- **Print settings:** quality presets, nozzle size, layer height, walls, top/bottom layers,
  infill (grid, lines, triangles), speeds, supports, skirt/brim, retraction and Z-hop.
- **Split large prints:** models too big for your printer are cut into parts that fit,
  joined with **dowel pins** (a pin on one part, a matching hole in the other), laid on their
  best side to need little support, and packed onto as few **plates** as possible (several
  pieces per plate when they fit). Pick the number of pieces yourself or let it choose. Change
  the model size and the number of pieces and plates updates live. Download all pieces as
  **STL files** or one **G-code** file per plate, each as a zip.
- **Finish options:** variable layer height (adaptive thin layers on curves plus your own
  height ranges), seam placement (aligned, nearest, rear, random) and ironing of top surfaces.
- **Angled cuts & assembly guide:** tilt any cut up to 60°, and download a printable PDF guide
  with every piece numbered, which plate it's on and which pieces it joins.
- **Export to any slicer:** a project zip with one 3MF per plate (pieces laid flat and placed),
  the uncut model and your settings (supports off, so you can add your own) for Bambu Studio,
  OrcaSlicer, PrusaSlicer, Cura, Creality Print and others.
- **Save projects:** a `.splicer` file keeps your model and every setting so you can carry on later.
- **Layer preview:** step through every layer in 3D before you print.
- **Estimates:** print time, filament length, weight and cost.
- Reads **STL, OBJ and 3MF** files.

## Quick start (for developers)

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/kellieja/3d-splicer.git
cd 3d-splicer
npm install
npm run dev        # open http://localhost:5173
```

| Command            | What it does                                  |
| ------------------ | --------------------------------------------- |
| `npm run dev`      | Starts a local dev server with hot reload     |
| `npm test`         | Runs the slicer test suite                    |
| `npm run build`    | Type-checks and builds the website into `dist/` |
| `npm run preview`  | Serves the built website locally              |

## Publishing the website

### GitHub Pages (already set up)

1. Push to the `main` branch.
2. On GitHub, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` runs the tests, builds the site and publishes
   it to `https://<your-user>.github.io/3d-splicer/`. It re-deploys on every push to `main`.

### Adding it to another website

`npm run build` makes a plain static folder (`dist/`) that works from any path. You can:

- upload the `dist/` folder to any web host (Netlify, Vercel, Cloudflare Pages, your own server), or
- embed the hosted slicer in an existing page:

```html
<iframe src="https://kellieja.github.io/3d-splicer/" style="width:100%;height:90vh;border:0" title="3D Splicer"></iframe>
```

See [docs/EMBEDDING.md](docs/EMBEDDING.md) for more options.

## How it works

```
 STL / OBJ / 3MF ──► loaders ──► scale / rotate / place on bed ──► Web Worker:
                                                                  1. slice the mesh into layer outlines
                                                                  2. walls, top/bottom skin, infill, supports, skirt/brim
                                                                  3. G-code + time / filament estimate
                                                     ◄── preview lines + G-code file
```

| Folder / file               | Purpose                                                       |
| --------------------------- | ------------------------------------------------------------- |
| `src/slicer/mesh.ts`        | Scaling, rotation, bed placement, fit checks, sample models   |
| `src/slicer/slice.ts`       | Cuts triangles with horizontal planes and joins them into outlines |
| `src/slicer/geometry.ts`    | Polygon offset and boolean helpers ([Clipper](https://www.npmjs.com/package/clipper-lib)) |
| `src/slicer/toolpaths.ts`   | Walls, solid/sparse infill, supports, skirt and brim          |
| `src/slicer/gcode.ts`       | G-code writer, extrusion maths and time estimate              |
| `src/slicer/split.ts`       | Cutting large models (straight or tilted), dowel joints, orientation, plate packing |
| `src/slicer/layers.ts`      | Variable / adaptive layer heights                              |
| `src/lib/threemf.ts`, `exportProject.ts` | 3MF writer and the "export for other slicers" zip |
| `src/lib/assemblyGuide.ts`, `pdf.ts` | Printable assembly guide PDF                       |
| `src/profiles/`             | Printer, filament and print-setting profiles                  |
| `src/components/`           | React UI and the Three.js viewer                              |
| `src/workers/`              | Runs the slicer off the main thread                           |
| `tests/`                    | Vitest tests for the slicer                                   |

## Using it

The app walks you through six steps: **1 Model → 2 Printer → 3 Size → 4 Split → 5 Settings → 6 Download**.
Use **Next / Back** or click a step number. The **Simple / Advanced** switch at the top shows just
the basics, or every setting (temperatures, walls, speeds, seam, ironing, variable layers, cut
positions and tilts, dowel sizes, custom printers…).

## Splitting large prints

1. **Model:** open your file (or drag it onto the 3D view).
2. **Printer:** choose your printer and filament.
3. **Size:** set the size you want. If it's bigger than your printer, that's fine.
4. **Split:** answer **Yes**, then choose **Auto** (fewest pieces that fit) or **Choose** a number.
   The **All plates** view shows every plate side by side with the pieces lying flat.
   In **Advanced** you can move or tilt cuts (up to 60°) and change the dowel pins.
5. **Settings:** pick a quality preset and infill.
6. **Download:** slice and download the G-code (one file per plate), the pieces as STL files,
   a printable **assembly guide (PDF)** with every piece numbered, or a project for another slicer.

Separate bits (like an arm that doesn't touch the rest after a cut) become their own pieces, so
nothing is left floating in the air. Tiny crumbs under 5 mm³ are left out.
When assembling, push each pin into its matching hole, optionally with a drop of glue.
If a joint face is too small or thin for a dowel, the app says so and you can just glue that joint.

## Exporting to another slicer

In step **6 Download**, click **Project for another slicer (.zip)**. Inside:

| File | What it's for |
| --- | --- |
| `Plate 1.3mf`, `Plate 2.3mf`, … | One standard 3MF per plate, pieces laid flat and placed. Opens in every slicer. |
| `All plates.3mf` | Every piece in one file. They open together on plate 1; press **Arrange** in Creality Print, Bambu Studio or OrcaSlicer to spread them over the plates. |
| `Creality-Orca project (beta).3mf` | **Experimental:** the plates already set up for Creality Print, OrcaSlicer and Bambu Studio (File → Open Project). If it doesn't work in your version, use `All plates.3mf`. |
| `Original model.3mf` | The whole model before cutting. |
| `settings.ini` | Your settings for PrusaSlicer / SuperSlicer (File → Import Config). |
| `SETTINGS.txt` | The same settings in plain English, to copy into any slicer. |
| `HOW TO OPEN.txt` | Step-by-step for Bambu Studio, OrcaSlicer, PrusaSlicer, Cura and others. |

Supports are turned **off** in the exported settings so you can add your own (normal, tree or painted).

**Save project** keeps the model and all your choices in a `.splicer` file; open it again with
**Open project…** (or just open the `.splicer` file like a model).

## Printer notes

- **Klipper printers** (Voron, Creality K1/K2 Plus, Elegoo Neptune 4, QIDI…) call your
  `PRINT_START` or `START_PRINT` macro. If your macro has a different name, use **Copy & edit**
  on the printer and change the start G-code.
- **Creality K2 Plus:** uses the firmware's `START_PRINT` / `END_PRINT` macros. Files print
  with a single filament. CFS multi-colour changes and chamber heating are not controlled by 3D Splicer yet.
- **Bambu Lab** printers work best with files sent from Bambu Studio. Plain G-code from 3D Splicer
  can be printed from the SD card, but the AMS and automatic calibration are not used.
- Always check your first print, especially the first layer, and adjust the start G-code for your machine.

## Roadmap / ideas for contributors

- More infill patterns (gyroid, honeycomb) and tree supports
- Multi-material / colour changes (AMS, CFS, MMU)
- Several models on the bed and auto-arrange
- Import printer profiles from Cura / PrusaSlicer
- Resin (SLA/MSLA) output

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/ADDING_PRINTERS.md](docs/ADDING_PRINTERS.md).

## License

[MIT](LICENSE)
