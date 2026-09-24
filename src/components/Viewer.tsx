import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PreviewData, PrinterProfile } from '../types';
import type { TriangleSoup } from '../slicer/mesh';

export interface ViewerMesh {
  positions: TriangleSoup;
  color: number;
}

/** A cut plane (straight or tilted) drawn as a translucent square. */
export interface CutPlane {
  normal: [number, number, number];
  point: [number, number, number];
  /** Width of the square in mm. */
  size: number;
}

export interface ViewerProps {
  printer: PrinterProfile;
  meshes: ViewerMesh[];
  planes?: CutPlane[];
  preview: PreviewData | null;
  mode: 'model' | 'preview';
  /** Highest layer shown in preview mode. */
  layer: number;
  /** When this changes, the camera re-frames the bed and everything on it. */
  frameKey?: string;
  /**
   * Draw several copies of the bed (e.g. every plate side by side), each
   * shifted by x/y mm and labelled. Default: one bed, no offset.
   */
  beds?: BedCopy[];
}

export interface BedCopy {
  x: number;
  y: number;
  label?: string;
}

interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  bed: THREE.Group;
  model: THREE.Group;
  planes: THREE.Group;
  toolpaths: THREE.LineSegments;
  current: THREE.LineSegments;
  render: () => void;
}


/** Three.js view of the build plate, the model and the sliced toolpaths. Z is up. */
export function Viewer({ printer, meshes, planes = [], preview, mode, layer, frameKey, beds }: ViewerProps) {
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

    const model = new THREE.Group();
    scene.add(model);
    const planeGroup = new THREE.Group();
    scene.add(planeGroup);

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

    sceneRef.current = { renderer, scene, camera, controls, bed, model, planes: planeGroup, toolpaths, current, render };
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
    disposeChildren(s.bed);
    const copies = beds ?? [{ x: 0, y: 0 }];
    for (const c of copies) {
      const bed = buildBed(printer, copies.length === 1);
      bed.position.set(c.x, c.y, 0);
      if (c.label) bed.add(labelSprite(c.label, printer));
      s.bed.add(bed);
    }
    s.render();
  }, [printer, beds]);

  // Camera: frame the bed plus the model (which may be bigger than the bed).
  const meshesRef = useRef(meshes);
  meshesRef.current = meshes;
  useEffect(() => {
    const s = sceneRef.current!;
    const box = new THREE.Box3();
    const x0 = printer.originCenter ? -printer.bedX / 2 : 0;
    const y0 = printer.originCenter ? -printer.bedY / 2 : 0;
    for (const c of beds ?? [{ x: 0, y: 0 }]) {
      box.expandByPoint(new THREE.Vector3(x0 + c.x, y0 + c.y - 30, 0));
      box.expandByPoint(new THREE.Vector3(x0 + c.x + printer.bedX, y0 + c.y + printer.bedY, Math.min(printer.maxZ, 60)));
    }
    for (const m of meshesRef.current) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      g.computeBoundingBox();
      if (g.boundingBox) box.union(g.boundingBox);
    }
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    // Several plates: look down steeply so every plate is visible side by side.
    const many = (beds?.length ?? 1) > 1;
    const dir = new THREE.Vector3(many ? 0.05 : 0.15, many ? -0.5 : -1, many ? 1 : 0.65).normalize();
    // Fit the whole box in view, leaving the bottom quarter free for the Slice panel.
    const cam = s.camera;
    cam.aspect = Math.max(0.2, cam.aspect);
    const tanV = Math.tan(((cam.fov / 2) * Math.PI) / 180);
    const tanH = tanV * cam.aspect;
    const usableV = 0.72;
    const forward = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 0, 1)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    let dist = 1;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const rel = new THREE.Vector3(x, y, z).sub(centre);
          const depth = rel.dot(dir); // towards the camera
          dist = Math.max(dist, depth + Math.abs(rel.dot(right)) / (tanH * 0.94), depth + Math.abs(rel.dot(up)) / (tanV * usableV));
        }
    const target = centre.clone().addScaledVector(up, -dist * tanV * (1 - usableV) * 0.9);
    s.controls.target.copy(target);
    cam.position.copy(target).addScaledVector(dir, dist);
    s.camera.far = size * 20;
    s.camera.updateProjectionMatrix();
    s.render();
    // `beds` changes identity whenever the plate count changes, which is also when we want to re-frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printer, frameKey, beds?.length]);

  // Model meshes (one per part when the model is split).
  useEffect(() => {
    const s = sceneRef.current!;
    disposeChildren(s.model);
    for (const m of meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      g.computeVertexNormals();
      s.model.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.55, metalness: 0.05 })));
    }
    s.render();
  }, [meshes]);

  // Cut planes.
  useEffect(() => {
    const s = sceneRef.current!;
    disposeChildren(s.planes);
    for (const p of planes) {
      const geo = new THREE.PlaneGeometry(p.size, p.size);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
      );
      // PlaneGeometry faces +Z; turn it to face the cut's normal.
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...p.normal).normalize());
      mesh.quaternion.copy(q);
      mesh.position.set(...p.point);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xf97316 }));
      edges.quaternion.copy(q);
      edges.position.copy(mesh.position);
      s.planes.add(mesh, edges);
    }
    s.render();
  }, [planes]);

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
    s.planes.visible = !showPreview;
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

function disposeChildren(group: THREE.Group) {
  for (const child of [...group.children]) {
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        (x as THREE.MeshBasicMaterial).map?.dispose();
        x.dispose();
      }
    });
    group.remove(child);
  }
}

/** A flat text label lying on the bed, just in front of it. */
function labelSprite(text: string, p: PrinterProfile): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f97316';
  ctx.font = 'bold 72px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const w = Math.min(p.bedX * 0.6, 120);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  const x0 = p.originCenter ? -p.bedX / 2 : 0;
  const y0 = p.originCenter ? -p.bedY / 2 : 0;
  mesh.position.set(x0 + p.bedX / 2, y0 - w / 8 - 4, 0.1);
  return mesh;
}

function buildBed(p: PrinterProfile, withVolume = true): THREE.Group {
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

  if (!withVolume) return g;

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
