import * as THREE from 'three';
import type { SplitResult } from '../slicer/split';
import { A4, buildPdf, pdfSafe, textWidth, type PdfImage, type PdfItem } from './pdf';

/*
 * Printable assembly guide for a split model: a picture of the whole model
 * pulled apart with every piece coloured and numbered, and a list saying
 * which plate each piece is on and which pieces it joins.
 */

export interface GuidePiece {
  number: number;
  color: number;
  plate: number;
  joins: number[];
  pins: number;
  holes: number;
}

export interface GuideInfo {
  title: string;
  lines: string[];
  pieces: GuidePiece[];
}

const hex = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/** Lays out the PDF pages. Kept separate from rendering so it can be tested without a browser. */
export function buildGuidePdf(info: GuideInfo, picture: PdfImage): Uint8Array {
  const M = 40;
  const pages: PdfItem[][] = [];
  let page: PdfItem[] = [];
  let y = A4.h - M;

  page.push({ type: 'text', x: M, y: y - 18, size: 20, text: 'Assembly guide', bold: true });
  page.push({ type: 'text', x: M, y: y - 38, size: 12, text: info.title });
  y -= 52;
  for (const line of info.lines) {
    page.push({ type: 'text', x: M, y: y - 11, size: 9.5, text: line, color: [0.35, 0.37, 0.42] });
    y -= 13;
  }
  y -= 6;

  // Picture, as large as fits in the page width and about half the height.
  const maxW = A4.w - 2 * M, maxH = A4.h * 0.48;
  const scale = Math.min(maxW / picture.width, maxH / picture.height);
  const w = picture.width * scale, h = picture.height * scale;
  page.push({ type: 'image', x: M + (maxW - w) / 2, y: y - h, w, h, image: 0 });
  y -= h + 14;
  const hint = 'Pieces are pulled apart and numbered. Push each pin into the matching hole of the piece it joins.';
  page.push({ type: 'text', x: M, y, size: 9, text: hint, color: [0.35, 0.37, 0.42] });
  y -= 22;

  const header = () => {
    const cols: [number, string][] = [[M, 'Piece'], [M + 70, 'Plate'], [M + 120, 'Joins pieces'], [M + 330, 'Pins'], [M + 380, 'Holes'], [M + 440, 'Done']];
    for (const [x, t] of cols) page.push({ type: 'text', x, y, size: 9.5, text: t, bold: true });
    y -= 6;
    page.push({ type: 'line', x1: M, y1: y, x2: A4.w - M, y2: y, color: [0.6, 0.6, 0.65] });
    y -= 15;
  };
  header();
  for (const pc of info.pieces) {
    if (y < M + 20) {
      pages.push(page);
      page = [];
      y = A4.h - M - 10;
      header();
    }
    page.push({ type: 'rect', x: M, y: y - 2, w: 10, h: 10, color: hex(pc.color) });
    page.push({ type: 'text', x: M + 16, y, size: 10, text: String(pc.number), bold: true });
    page.push({ type: 'text', x: M + 70, y, size: 10, text: String(pc.plate) });
    let joins = pc.joins.length ? pc.joins.join(', ') : '-';
    while (textWidth(joins, 10) > 200 && joins.length > 4) joins = joins.slice(0, -4) + '...';
    page.push({ type: 'text', x: M + 120, y, size: 10, text: joins });
    page.push({ type: 'text', x: M + 330, y, size: 10, text: String(pc.pins) });
    page.push({ type: 'text', x: M + 380, y, size: 10, text: String(pc.holes) });
    page.push({ type: 'rect', x: M + 446, y: y - 2, w: 9, h: 9, color: [0.55, 0.55, 0.6] });
    page.push({ type: 'rect', x: M + 447, y: y - 1, w: 7, h: 7, color: [1, 1, 1] });
    y -= 6;
    page.push({ type: 'line', x1: M, y1: y, x2: A4.w - M, y2: y });
    y -= 14;
  }
  pages.push(page);
  pages.forEach((p, i) =>
    p.push({ type: 'text', x: A4.w - M - 60, y: M / 2, size: 8, text: `Page ${i + 1} of ${pages.length}`, color: [0.5, 0.5, 0.55] }),
  );
  return buildPdf(pages, [picture], pdfSafe(`Assembly guide - ${info.title}`));
}

/** Renders the pulled-apart model with numbered pieces into a JPEG (browser only). */
export async function renderGuidePicture(split: SplitResult, colors: number[], gap: number): Promise<PdfImage> {
  const W = 1600, H = 1100;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.setClearColor(0xffffff, 1);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, -1.6, 2.2);
  scene.add(sun);

  const counts = split.cuts.map((c) => c.length + 1);
  const box = new THREE.Box3();
  const centres: THREE.Vector3[] = [];
  split.parts.forEach((p, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.positions.slice(), 3));
    g.computeVertexNormals();
    g.computeBoundingBox();
    const off = new THREE.Vector3(...[0, 1, 2].map((a) => (p.cell[a] - (counts[a] - 1) / 2) * gap));
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.6 }));
    mesh.position.copy(off);
    scene.add(mesh);
    const bb = g.boundingBox!.clone().translate(off);
    box.union(bb);
    centres.push(bb.getCenter(new THREE.Vector3()));
  });

  const camera = new THREE.PerspectiveCamera(30, W / H, 1, 1e6);
  camera.up.set(0, 0, 1);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  camera.position.set(centre.x + size * 0.9, centre.y - size * 1.5, centre.z + size * 0.9);
  camera.lookAt(centre);
  camera.updateMatrixWorld();
  renderer.render(scene, camera);

  // Numbers on top of the picture.
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(renderer.domElement, 0, 0);
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  centres.forEach((c, i) => {
    const v = c.clone().project(camera);
    const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(17,17,17,0.85)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(String(i + 1), x, y + 1);
  });

  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose?.();
  });
  renderer.dispose();
  renderer.forceContextLoss();

  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the picture.'))), 'image/jpeg', 0.9));
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: W, height: H };
}

/** Everything the guide needs about the pieces, from a split result. */
export function guidePieces(split: SplitResult, colors: number[]): GuidePiece[] {
  const plateOf = new Map<number, number>();
  split.plates.forEach((pl, i) => pl.parts.forEach((pp) => plateOf.set(pp.part, i + 1)));
  return split.parts.map((p, i) => ({
    number: i + 1,
    color: colors[i % colors.length],
    plate: plateOf.get(i) ?? 0,
    joins: p.joins.map((j) => j + 1),
    pins: p.pins,
    holes: p.holes,
  }));
}
