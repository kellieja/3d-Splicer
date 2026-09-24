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
| `src/profiles/`             | Printer, filament and print-setting profiles                  |
| `src/components/`           | React UI and the Three.js viewer                              |
| `src/workers/`              | Runs the slicer off the main thread                           |
| `tests/`                    | Vitest tests for the slicer                                   |

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
- Ironing, variable layer height and seam placement options
- Import printer profiles from Cura / PrusaSlicer
- Resin (SLA/MSLA) output

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/ADDING_PRINTERS.md](docs/ADDING_PRINTERS.md).

## License

[MIT](LICENSE)
