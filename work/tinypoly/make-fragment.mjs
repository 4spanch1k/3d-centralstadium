import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { writeFile } from 'node:fs/promises';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => { this.result = result; this.onloadend(); });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;
      this.onloadend();
    });
  }
};

const scene = new THREE.Scene();
const concrete = new THREE.MeshStandardMaterial({ color: '#a4aca2', roughness: 0.9 });
const seatMaterials = [
  new THREE.MeshStandardMaterial({ color: '#d9bb5a', roughness: 0.8 }),
  new THREE.MeshStandardMaterial({ color: '#365469', roughness: 0.8 }),
];
const groups = [[], []];
for (let row = 0; row < 10; row += 1) {
  const platform = new THREE.Mesh(new THREE.BoxGeometry(32, 0.62, 1.15), concrete);
  platform.position.set(0, row * 0.62, -53 - row * 1.15);
  platform.name = `Ряд ${row + 1}`;
  scene.add(platform);
  for (let seat = 0; seat < 40; seat += 1) {
    if (seat === 19 || seat === 20) continue;
    const x = (seat - 19.5) * 0.78;
    const y = row * 0.62 + 0.55;
    const z = -53 - row * 1.15;
    const color = Math.floor(seat / 10) % 2;
    const base = new THREE.BoxGeometry(0.5, 0.12, 0.48);
    base.translate(x, y, z);
    const back = new THREE.BoxGeometry(0.5, 0.55, 0.1);
    back.translate(x, y + 0.3, z - 0.19);
    groups[color].push(base, back);
  }
}
for (let index = 0; index < groups.length; index += 1) {
  const mesh = new THREE.Mesh(mergeGeometries(groups[index]), seatMaterials[index]);
  mesh.name = index ? 'Синие кресла' : 'Жёлтые кресла';
  scene.add(mesh);
}
const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
await writeFile('../../work/tinypoly/tribuna-maket.glb', Buffer.from(glb));
console.log('Создан пробный фрагмент западной трибуны.');
