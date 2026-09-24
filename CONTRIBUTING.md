# Contributing to 3D Splicer

Thanks for helping! Bug reports, printer profiles and code are all welcome.

## Getting started

```bash
npm install
npm run dev     # local site with hot reload
npm test        # slicer tests
npm run build   # type-check + production build
```

## Guidelines

- Keep the slicer code in `src/slicer/` free of React and DOM code, so it can run in a Web Worker and in tests.
- Add or update a test in `tests/` when you change slicing or G-code behaviour.
- Run `npm test` and `npm run build` before opening a pull request. CI runs both.
- Keep pull requests focused: one feature or fix per PR.

## Reporting a bad print

Please include:

1. the printer and filament profile you used (and any settings you changed),
2. the model file if you can share it,
3. a photo of the print or a screenshot of the layer preview.

## Adding a printer

See [docs/ADDING_PRINTERS.md](docs/ADDING_PRINTERS.md).
