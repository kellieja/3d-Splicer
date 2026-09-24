# Adding a printer profile

There are two ways to add a printer.

## 1. In the app (just for you)

In **1. Printer**, click **Copy & edit** (starts from the selected printer) or **New custom printer**,
fill in the details and click **Save printer**. Custom printers are stored in your browser.

## 2. In the code (for everyone)

Add an entry to `BUILTIN_PRINTERS` in [`src/profiles/printers.ts`](../src/profiles/printers.ts):

```ts
printer({
  id: 'brand-model',            // unique, lowercase, used in file names
  manufacturer: 'Brand',        // groups printers in the dropdown
  name: 'Model name',
  bedX: 220, bedY: 220, maxZ: 250,
  retractLength: 0.8,           // ~0.5–1 mm direct drive, ~4–6 mm Bowden
  maxPrintSpeed: 150,           // mm/s the machine prints reliably at
  acceleration: 3000,           // mm/s², used for time estimates
  maxNozzleTemp: 300,
  maxBedTemp: 110,
  flavor: 'klipper',            // 'marlin' | 'klipper' | 'reprap' | 'bambu'
  startGcode: KLIPPER_START,    // or a custom string
  endGcode: KLIPPER_END,
  notes: 'Anything the user should know.',
}),
```

Fields you leave out use these defaults: 1.75 mm filament, 0.4 mm nozzle, heated bed,
rectangular bed with the origin at the front-left corner, Marlin start/end G-code.
For delta printers set `bedShape: 'circle'` and `originCenter: true`.

### Start G-code placeholders

| Placeholder                 | Replaced with                     |
| --------------------------- | --------------------------------- |
| `{nozzle_temp}`             | Filament nozzle temperature       |
| `{first_layer_nozzle_temp}` | First-layer nozzle temperature    |
| `{bed_temp}`                | Bed temperature                   |
| `{first_layer_bed_temp}`    | First-layer bed temperature       |
| `{bed_x}` / `{bed_y}`       | Bed size in mm                    |
| `{max_z}`                   | Maximum height in mm              |
| `{filament_diameter}`       | 1.75 or 2.85                      |

After adding a printer, run `npm test`: it checks that every profile has a unique id and sane values.
Please say in your pull request where the specs came from and whether you have test-printed with the profile.
