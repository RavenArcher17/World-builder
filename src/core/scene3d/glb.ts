/**
 * Writes a 3D scene as binary glTF 2.0 (.glb), the 3D file Godot, Unity, Blender and three.js
 * all import. Meshes keep their vertex colours; solid parts are named with Godot's "-col"
 * suffix so the importer gives them collision; markers are empty nodes whose glTF `extras`
 * carry the place or object they stand for. Conventions: docs/3d-export.md.
 */
import type { Scene3D } from './build';
import { type MeshData, linearColors } from './mesh';

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

interface Gltf {
  asset: { version: string; generator: string };
  scene: number;
  scenes: { name: string; nodes: number[] }[];
  nodes: Record<string, unknown>[];
  meshes: Record<string, unknown>[];
  materials: Record<string, unknown>[];
  accessors: Record<string, unknown>[];
  bufferViews: Record<string, unknown>[];
  buffers: { byteLength: number }[];
}

export function sceneToGlb(scene: Scene3D): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const gltf: Gltf = {
    asset: { version: '2.0', generator: 'World Builder (https://world-builder-fc2cf.web.app)' },
    scene: 0,
    scenes: [{ name: scene.name, nodes: [0] }],
    nodes: [],
    meshes: [],
    materials: [
      { name: 'Painted', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.95 } },
      {
        name: 'Water',
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.12 },
        alphaMode: 'BLEND',
        doubleSided: true,
      },
    ],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };

  const view = (bytes: Uint8Array, target: number): number => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      offset += pad;
    }
    chunks.push(bytes);
    gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    offset += bytes.byteLength;
    return gltf.bufferViews.length - 1;
  };
  const accessor = (a: Record<string, unknown>): number => {
    gltf.accessors.push(a);
    return gltf.accessors.length - 1;
  };
  const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

  const meshIndex = (m: MeshData, material: number, name: string): number => {
    const count = m.positions.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < m.positions.length; k += 3) {
      for (let a = 0; a < 3; a++) {
        const v = m.positions[k + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
    const pos = accessor({ bufferView: view(bytesOf(m.positions), ARRAY_BUFFER), componentType: FLOAT, count, type: 'VEC3', min, max });
    const nrm = accessor({ bufferView: view(bytesOf(m.normals), ARRAY_BUFFER), componentType: FLOAT, count, type: 'VEC3' });
    const col = accessor({ bufferView: view(bytesOf(linearColors(m.colors)), ARRAY_BUFFER), componentType: UNSIGNED_SHORT, normalized: true, count, type: 'VEC4' });
    const small = count <= 65535;
    const idx = small ? Uint16Array.from(m.indices) : m.indices;
    const ind = accessor({
      bufferView: view(bytesOf(idx), ELEMENT_ARRAY_BUFFER),
      componentType: small ? UNSIGNED_SHORT : UNSIGNED_INT,
      count: m.indices.length,
      type: 'SCALAR',
    });
    gltf.meshes.push({ name, primitives: [{ attributes: { POSITION: pos, NORMAL: nrm, COLOR_0: col }, indices: ind, material, mode: 4 }] });
    return gltf.meshes.length - 1;
  };

  // Node 0 is the map; parts and the markers group hang off it.
  gltf.nodes.push({ name: safeNodeName(scene.name) || 'Map', children: [], extras: { worldBuilder: scene.info } });
  const root = gltf.nodes[0].children as number[];
  for (const part of scene.parts) {
    if (!part.mesh.indices.length) continue;
    const mesh = meshIndex(part.mesh, part.kind === 'water' ? 1 : 0, part.name);
    gltf.nodes.push({ name: part.name, mesh, extras: { worldBuilder: { part: part.kind, solid: part.solid } } });
    root.push(gltf.nodes.length - 1);
  }
  if (scene.markers.length) {
    gltf.nodes.push({ name: 'Markers', children: [] });
    const group = gltf.nodes[gltf.nodes.length - 1].children as number[];
    root.push(gltf.nodes.length - 1);
    for (const m of scene.markers) {
      gltf.nodes.push({ name: safeNodeName(m.name), translation: m.position, extras: { worldBuilder: m.data } });
      group.push(gltf.nodes.length - 1);
    }
  }
  if (!gltf.meshes.length) {
    delete (gltf as Partial<Gltf>).meshes;
    delete (gltf as Partial<Gltf>).accessors;
    delete (gltf as Partial<Gltf>).bufferViews;
  }

  const binLength = offset + ((4 - (offset % 4)) % 4);
  if (binLength) gltf.buffers.push({ byteLength: binLength });
  else delete (gltf as Partial<Gltf>).buffers;

  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = json.byteLength + ((4 - (json.byteLength % 4)) % 4);
  const total = 12 + 8 + jsonLength + (binLength ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(json, 20);
  out.fill(0x20, 20 + json.byteLength, 20 + jsonLength);
  if (binLength) {
    const at = 20 + jsonLength;
    dv.setUint32(at, binLength, true);
    dv.setUint32(at + 4, 0x004e4942, true); // "BIN\0"
    let p = at + 8;
    for (const c of chunks) {
      out.set(c, p);
      p += c.byteLength;
    }
  }
  return out;
}

/** Godot treats some characters in node names as path separators; keep names plain. */
function safeNodeName(name: string): string {
  return name.replace(/[.:@/"%]/g, ' ').replace(/\s+/g, ' ').trim();
}
