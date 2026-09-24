import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import type { TriangleSoup } from '../slicer/mesh';

export const SUPPORTED_EXTENSIONS = ['.stl', '.obj', '.3mf'];

/** Converts any Three.js geometry to a non-indexed triangle soup. */
function geometryToSoup(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): TriangleSoup {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (matrix) g.applyMatrix4(matrix);
  const attr = g.getAttribute('position');
  const out = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) {
    out[i * 3] = attr.getX(i);
    out[i * 3 + 1] = attr.getY(i);
    out[i * 3 + 2] = attr.getZ(i);
  }
  g.dispose();
  return out;
}

function objectToSoup(root: THREE.Object3D): TriangleSoup {
  root.updateMatrixWorld(true);
  const parts: TriangleSoup[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) parts.push(geometryToSoup(mesh.geometry, mesh.matrixWorld));
  });
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Rotates Y-up data (common for OBJ files) to the Z-up convention used by printers. */
function yUpToZUp(soup: TriangleSoup): TriangleSoup {
  for (let i = 0; i < soup.length; i += 3) {
    const y = soup[i + 1];
    soup[i + 1] = -soup[i + 2];
    soup[i + 2] = y;
  }
  return soup;
}

export async function loadModelFile(file: File): Promise<TriangleSoup> {
  const name = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();
  let soup: TriangleSoup;
  if (name.endsWith('.stl')) {
    soup = geometryToSoup(new STLLoader().parse(buffer));
  } else if (name.endsWith('.obj')) {
    const text = new TextDecoder().decode(buffer);
    soup = yUpToZUp(objectToSoup(new OBJLoader().parse(text)));
  } else if (name.endsWith('.3mf')) {
    soup = objectToSoup(new ThreeMFLoader().parse(buffer));
  } else {
    throw new Error(`Unsupported file type. Please use ${SUPPORTED_EXTENSIONS.join(', ')}.`);
  }
  if (soup.length < 9) throw new Error('This file does not contain any triangles.');
  for (let i = 0; i < soup.length; i++) {
    if (!Number.isFinite(soup[i])) throw new Error('This file contains invalid coordinates.');
  }
  return soup;
}
