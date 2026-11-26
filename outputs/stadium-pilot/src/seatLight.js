// Экспериментальное запечённое затенение кресел (pre/light/day/seat-ao.png, 800×34: x = pathIndex, y = rowIndex).
// Включается только по ?light=1. Затемняет лишь рассеянный свет (небо и окружение), прямое солнце не трогает.
import * as THREE from 'three';

export function createSeatLight({ url, strength = 0.6, onReady }) {
  const uniform = { value: strength };
  const meshes = new Set();
  let map = null; // { data, width, height }

  const valueFor = (seat) => {
    if (!map || !seat) return 1;
    const offset = (seat.rowIndex * map.width + seat.pathIndex) * 4;
    return map.data[offset + 3] ? map.data[offset] / 255 : 1; // A = 0: пробы нет, нейтраль.
  };

  async function load() {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Это данные, а не картинка: читаем без цветокоррекции.
    const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    map = { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
    for (const mesh of meshes) {
      const { attribute, seats } = mesh.userData.seatLight;
      seats.forEach((seat, index) => attribute.setX(index, valueFor(seat)));
      attribute.needsUpdate = true;
    }
    onReady?.();
  }
  load().catch((error) => console.warn('Карта затенения кресел не загрузилась', error));

  return {
    uniform,
    // Добавляет материалу множитель по экземпляру; вызывать после остальных правок шейдера.
    patch(material) {
      const previous = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        shader.uniforms.uSeatAoStrength = uniform;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float seatAo;\nvarying float vSeatAo;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeatAo = seatAo;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vSeatAo;\nuniform float uSeatAoStrength;')
          .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= mix(1.0, vSeatAo, uSeatAoStrength);');
      };
      material.customProgramCacheKey = () => 'seat-light';
      material.needsUpdate = true;
    },
    // У каждого меша своя копия геометрии (вершины общие), чтобы значения экземпляров не смешивались.
    // Повторный вызов нужен после замены геометрии меша.
    attach(mesh) {
      const capacity = mesh.instanceMatrix.count;
      const state = mesh.userData.seatLight
        || { attribute: new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1), seats: [] };
      mesh.userData.seatLight = state;
      const source = mesh.geometry;
      const geometry = new THREE.BufferGeometry();
      geometry.setIndex(source.index);
      for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
      for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
      geometry.setAttribute('seatAo', state.attribute);
      mesh.geometry = geometry;
      meshes.add(mesh);
    },
    set(mesh, index, seat) {
      const { attribute, seats } = mesh.userData.seatLight;
      seats[index] = seat;
      attribute.setX(index, valueFor(seat));
      attribute.needsUpdate = true;
    },
  };
}
