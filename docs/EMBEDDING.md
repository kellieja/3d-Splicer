# Putting 3D Splicer on your website

3D Splicer is a static site: HTML, CSS and JavaScript with no server. Slicing happens in
each visitor's browser, so hosting is free or cheap and scales to any number of users.

## Option A: GitHub Pages (built in)

1. In the GitHub repository, open **Settings → Pages** and choose **GitHub Actions** as the source.
2. Push to `main`. The `Deploy to GitHub Pages` workflow builds and publishes the site.
3. The site is served at `https://<user>.github.io/<repo>/`.

To use your own domain (e.g. `slicer.example.com`), add it under **Settings → Pages → Custom domain**
and create a `CNAME` DNS record pointing to `<user>.github.io`.

## Option B: Any static host

```bash
npm install
npm run build
```

Upload the contents of `dist/` to your host (Netlify, Vercel, Cloudflare Pages, S3, cPanel, …).
The build uses relative paths, so it also works from a sub-folder like `example.com/slicer/`.

## Option C: Embed in an existing page

```html
<iframe
  src="https://kellieja.github.io/3d-splicer/"
  title="3D Splicer"
  style="width: 100%; height: 90vh; border: 0; border-radius: 12px"
  allow="fullscreen"
></iframe>
```

G-code downloads work inside the iframe as long as you do not add a restrictive `sandbox` attribute.

## Option D: Use the slicing engine in your own code

The engine in `src/slicer/` has no UI dependencies:

```ts
import { slice } from './src/slicer';
import { placeOnBed, IDENTITY_TRANSFORM } from './src/slicer/mesh';
import { BUILTIN_PRINTERS } from './src/profiles/printers';
import { BUILTIN_FILAMENTS } from './src/profiles/filaments';
import { DEFAULT_SETTINGS } from './src/profiles/settings';

const printer = BUILTIN_PRINTERS.find((p) => p.id === 'creality-k2-plus')!;
const positions = placeOnBed(myTriangles, { ...IDENTITY_TRANSFORM, scale: [2, 2, 2] }, printer);
const { gcode, stats } = slice({ positions, printer, filament: BUILTIN_FILAMENTS[0], settings: DEFAULT_SETTINGS });
```

`myTriangles` is a `Float32Array` with 9 numbers (3 vertices × x, y, z, in mm, Z up) per triangle.
