/**
 * The 3D view (three.js). Loaded only when a map is first shown in 3D, so the 2D editor stays
 * light. It draws the same meshes the .glb export writes.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Scene3D } from '../core/scene3d/build';
import { linearColors } from '../core/scene3d/mesh';

export interface View3d {
  show(scene: Scene3D): void;
  reset(): void;
  /** Show or hide roofs and ceilings (hidden, you can see into buildings and dungeons). */
  setRoofs(visible: boolean): void;
  dispose(): void;
}

export function createView3d(host: HTMLElement): View3d {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = 'view3d-canvas';
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  // iOS Safari scrolls or zooms the page under a drag unless these are cancelled on the canvas.
  const stop = (e: Event) => e.preventDefault();
  for (const type of ['touchstart', 'touchmove'] as const) renderer.domElement.addEventListener(type, stop, { passive: false });
  for (const type of ['gesturestart', 'gesturechange']) renderer.domElement.addEventListener(type, stop);
  renderer.domElement.addEventListener('contextmenu', stop);

  const hemi = new THREE.HemisphereLight(0xe8f0ff, 0x5a4a38, 1.6);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(-0.55, 1, -0.35);
  scene.add(hemi, sun);

  const content = new THREE.Group();
  scene.add(content);
  let home: { target: THREE.Vector3; position: THREE.Vector3 } | null = null;
  let dirty = true;
  let roofs = false;
  controls.addEventListener('change', () => (dirty = true));

  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let frame = 0;
  const loop = () => {
    frame = requestAnimationFrame(loop);
    if (controls.update() || dirty) {
      dirty = false;
      renderer.render(scene, camera);
    }
  };
  loop();

  const clear = () => {
    for (const child of [...content.children]) {
      content.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    }
  };

  return {
    show(s: Scene3D) {
      clear();
      for (const part of s.parts) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(part.mesh.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(part.mesh.normals, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(linearColors(part.mesh.colors), 4, true));
        geo.setIndex(new THREE.BufferAttribute(part.mesh.indices, 1));
        const water = part.kind === 'water';
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: water ? 0.15 : 0.95,
          metalness: 0,
          transparent: water,
          depthWrite: !water,
          side: water ? THREE.DoubleSide : THREE.FrontSide,
          // Roads and rivers lie just above the ground; nudge them forward so they never flicker.
          polygonOffset: part.kind === 'roads' || water,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -2,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = part.name;
        if (water) mesh.renderOrder = 1;
        if (part.kind === 'roofs') mesh.visible = roofs;
        mesh.userData.kind = part.kind;
        content.add(mesh);
      }
      const [x0, y0, z0] = s.bounds.min;
      const [x1, y1, z1] = s.bounds.max;
      const size = Math.max(x1 - x0, z1 - z0, 1);
      const sky = new THREE.Color(s.underground ? 0x15161b : 0xa9c8e6);
      scene.background = sky;
      scene.fog = new THREE.Fog(sky, size * 1.6, size * 4.5);
      hemi.intensity = s.underground ? 2.2 : 1.6;
      camera.near = Math.max(0.05, size / 2000);
      camera.far = size * 8;
      camera.updateProjectionMatrix();
      controls.minDistance = Math.max(1, s.options.tile * 1.5);
      controls.maxDistance = size * 3;
      const target = new THREE.Vector3((x0 + x1) / 2, Math.max(0, y0 + (y1 - y0) * 0.25), (z0 + z1) / 2);
      // Back off far enough for the whole map to fit the view, narrow phone screens included.
      const vfov = (camera.fov * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
      const dist = Math.max(((x1 - x0) / 2) / Math.tan(hfov / 2), ((z1 - z0) * 0.75) / 2 / Math.tan(vfov / 2), 1) * 1.08;
      const angle = 0.85; // radians above the horizon
      home = { target, position: new THREE.Vector3(target.x, target.y + dist * Math.sin(angle), target.z + dist * Math.cos(angle)) };
      this.reset();
    },
    setRoofs(visible: boolean) {
      roofs = visible;
      for (const child of content.children) if (child.userData.kind === 'roofs') child.visible = visible;
      dirty = true;
    },
    reset() {
      if (!home) return;
      controls.target.copy(home.target);
      camera.position.copy(home.position);
      controls.update();
      dirty = true;
    },
    dispose() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      clear();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
