import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PreviewData, PrinterProfile } from '../types';
import type { TriangleSoup } from '../slicer/mesh';

export interface ViewerProps {
  printer: PrinterProfile;
  mesh: TriangleSoup | null;
  preview: PreviewData | null;
  mode: 'model' | 'preview';
  /** Highest layer shown in preview mode. */
  layer: number;
  outOfBounds: boolean;
}

interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  bed: THREE.Group;
  model: THREE.Mesh;
  toolpaths: THREE.LineSegments;
  current: THREE.LineSegments;
  render: () => void;
}

const MODEL_COLOR = 0x3b82f6;
const ERROR_COLOR = 0xef4444;

/** Three.js view of the build plate, the model and the sliced toolpaths. Z is up. */
export function Viewer({ printer, mesh, preview, mode, layer, outOfBounds }: ViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);

  // One-time setup.
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, -1.5, 2);
    scene.add(sun);

    const bed = new THREE.Group();
    scene.add(bed);

    const model = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: MODEL_COLOR, roughness: 0.55, metalness: 0.05 }),
    );
    scene.add(model);

    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true });
    const toolpaths = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
    scene.add(toolpaths);
    // The top visible layer is drawn a second time in white so it stands out.
    const current = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
    scene.add(current);

    let frame = 0;
    const render = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        controls.update();
        renderer.render(scene, camera);
      });
    };
    controls.addEventListener('change', render);

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    sceneRef.current = { renderer, scene, camera, controls, bed, model, toolpaths, current, render };
    resize();

    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // Bed and build volume.
  useEffect(() => {
    const s = sceneRef.current!;
    s.bed.clear();
    s.bed.add(buildBed(printer));
    const cx = printer.originCenter ? 0 : printer.bedX / 2;
    const cy = printer.originCenter ? 0 : printer.bedY / 2;
    const size = Math.max(printer.bedX, printer.bedY, printer.maxZ);
    s.controls.target.set(cx, cy, Math.min(40, printer.maxZ / 4));
    s.camera.position.set(cx + size * 0.2, cy - size * 1.35, size * 0.9);
    s.camera.far = size * 20;
    s.camera.updateProjectionMatrix();
    s.render();
  }, [printer]);

  // Model mesh.
  useEffect(() => {
    const s = sceneRef.current!;
    s.model.geometry.dispose();
    const g = new THREE.BufferGeometry();
    if (mesh) {
      g.setAttribute('position', new THREE.BufferAttribute(mesh, 3));
      g.computeVertexNormals();
    }
    s.model.geometry = g;
    s.render();
  }, [mesh]);

  useEffect(() => {
    const s = sceneRef.current!;
    const mat = s.model.material as THREE.MeshStandardMaterial;
    mat.color.setHex(outOfBounds ? ERROR_COLOR : MODEL_COLOR);
    s.render();
  }, [outOfBounds]);

  // Toolpath preview.
  useEffect(() => {
    const s = sceneRef.current!;
    s.toolpaths.geometry.dispose();
    s.current.geometry.dispose();
    const g = new THREE.BufferGeometry();
    const c = new THREE.BufferGeometry();
    if (preview) {
      const pos = new THREE.BufferAttribute(preview.positions, 3);
      g.setAttribute('position', pos);
      g.setAttribute('color', new THREE.BufferAttribute(preview.colors, 3));
      c.setAttribute('position', pos);
    }
    s.toolpaths.geometry = g;
    s.current.geometry = c;
    s.render();
  }, [preview]);

  // Visibility and layer range.
  useEffect(() => {
    const s = sceneRef.current!;
    const showPreview = mode === 'preview' && !!preview;
    s.model.visible = !showPreview;
    s.toolpaths.visible = showPreview;
    s.current.visible = showPreview;
    if (preview && showPreview) {
      const li = Math.max(0, Math.min(layer, preview.layerEnds.length - 1));
      const end = preview.layerEnds[li] ?? 0;
      const start = li > 0 ? preview.layerEnds[li - 1] : 0;
      s.toolpaths.geometry.setDrawRange(0, end);
      s.current.geometry.setDrawRange(start, end - start);
    }
    s.render();
  }, [mode, layer, preview]);

  return <div className="viewer" ref={hostRef} aria-label="3D view of the build plate" role="img" />;
}

function buildBed(p: PrinterProfile): THREE.Group {
  const g = new THREE.Group();
  const x0 = p.originCenter ? -p.bedX / 2 : 0;
  const y0 = p.originCenter ? -p.bedY / 2 : 0;
  const cx = x0 + p.bedX / 2, cy = y0 + p.bedY / 2;

  const plateMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9 });
  let plate: THREE.Mesh;
  if (p.bedShape === 'circle') {
    plate = new THREE.Mesh(new THREE.CircleGeometry(p.bedX / 2, 96), plateMat);
  } else {
    plate = new THREE.Mesh(new THREE.PlaneGeometry(p.bedX, p.bedY), plateMat);
  }
  plate.position.set(cx, cy, -0.05);
  g.add(plate);

  // 10 mm grid, clipped to the plate.
  const pts: number[] = [];
  const r = p.bedX / 2;
  for (let x = Math.ceil(x0 / 10) * 10; x <= x0 + p.bedX; x += 10) {
    let ya = y0, yb = y0 + p.bedY;
    if (p.bedShape === 'circle') {
      const h = Math.sqrt(Math.max(0, r * r - (x - cx) ** 2));
      [ya, yb] = [cy - h, cy + h];
    }
    pts.push(x, ya, 0, x, yb, 0);
  }
  for (let y = Math.ceil(y0 / 10) * 10; y <= y0 + p.bedY; y += 10) {
    let xa = x0, xb = x0 + p.bedX;
    if (p.bedShape === 'circle') {
      const h = Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));
      [xa, xb] = [cx - h, cx + h];
    }
    pts.push(xa, y, 0, xb, y, 0);
  }
  const grid = new THREE.BufferGeometry();
  grid.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: 0x4b5563 })));

  // Build volume outline.
  const volMat = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.5 });
  if (p.bedShape === 'circle') {
    const ring = new THREE.EllipseCurve(cx, cy, r, r).getPoints(96).map((v) => new THREE.Vector3(v.x, v.y, p.maxZ));
    g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), volMat));
  } else {
    const box = new THREE.BoxGeometry(p.bedX, p.bedY, p.maxZ);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), volMat);
    edges.position.set(cx, cy, p.maxZ / 2);
    g.add(edges);
  }

  // Axis hints at the origin: X red, Y green.
  const axes = new THREE.BufferGeometry();
  axes.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, 0.1, x0 + 20, y0, 0.1, x0, y0, 0.1, x0, y0 + 20, 0.1], 3));
  axes.setAttribute('color', new THREE.Float32BufferAttribute([1, 0.3, 0.3, 1, 0.3, 0.3, 0.3, 1, 0.4, 0.3, 1, 0.4], 3));
  g.add(new THREE.LineSegments(axes, new THREE.LineBasicMaterial({ vertexColors: true })));
  return g;
}
