// Экспериментальное запечённое затенение кресел (pre/light/day/seat-ao.png, 800×34: x = pathIndex, y = rowIndex).
// Включается только по ?light=1. Затемняет лишь рассеянный свет (небо и окружение), прямое солнце не трогает.
import * as THREE from 'three';

// Карта 800×34 как есть: это данные, а не картинка, поэтому читаем без цветокоррекции.
async function readMap(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}

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
    map = await readMap(url);
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

// Контактное затенение ступеней под креслами. У бетона нет привязки к ряду и позиции, поэтому пробы
// (pre/light/day/concrete-ao.png) один раз раскладываются в карту «вид сверху» по координатам кресел:
// мягкое пятно вдоль ряда под каждым местом. Шейдер читает её по (x, z) только на горизонтальных гранях.
export function createConcreteContact({ url, seats, rect, size = 2048, strength = 0.6, onReady }) {
  const empty = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  empty.needsUpdate = true;
  const uniforms = { uContactMap: { value: empty }, uContactStrength: { value: strength } };

  async function load() {
    const map = await readMap(url);
    // Пробы шумные (мало сэмплов), поэтому берём среднее по соседним позициям того же ряда.
    const occlusion = (seat) => {
      let sum = 0; let count = 0;
      for (let step = -4; step <= 4; step += 1) {
        const path = seat.pathIndex + step;
        if (path < 0 || path >= map.width) continue;
        const offset = (seat.rowIndex * map.width + path) * 4;
        if (map.data[offset + 3]) { sum += map.data[offset] / 255; count += 1; }
      }
      return count ? sum / count : 1;
    };
    const [left, top, width, depth] = rect;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = Math.round(size * depth / width);
    const context = canvas.getContext('2d');
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'lighten'; // перекрытия соседних пятен не складываются
    const scale = canvas.width / width;
    for (const seat of seats) {
      if (seat.hidden) continue;
      const value = Math.round((1 - occlusion(seat)) * 255);
      const axis = seat.matrix.elements; // локальная ось X кресла направлена вдоль ряда
      context.setTransform(1, 0, 0, 1, (seat.position.x - left) * scale, (seat.position.z - top) * scale);
      context.rotate(Math.atan2(axis[2], axis[0]));
      context.scale(0.55 * scale, 0.42 * scale); // полуоси пятна, метры
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, `rgb(${value},${value},${value})`);
      gradient.addColorStop(0.5, `rgb(${value},${value},${value})`);
      gradient.addColorStop(1, '#000');
      context.fillStyle = gradient;
      context.fillRect(-1, -1, 2, 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    uniforms.uContactMap.value = texture;
    empty.dispose();
    onReady?.();
  }
  load().catch((error) => console.warn('Карта затенения бетона не загрузилась', error));

  return {
    uniforms,
    // Только для материалов, уже прошедших weather(): использует vWeatherPos, uAoRect и faceNormal.
    patch(material) {
      const previous = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D uContactMap;\nuniform float uContactStrength;')
          .replace('#include <aomap_fragment>', `#include <aomap_fragment>
{
  vec2 contactUv = vec2((vWeatherPos.x - uAoRect.x) / uAoRect.z, 1.0 - (vWeatherPos.z - uAoRect.y) / uAoRect.w);
  float contact = texture2D(uContactMap, contactUv).r * uContactStrength * smoothstep(0.7, 0.9, abs(faceNormal.y));
  reflectedLight.indirectDiffuse *= 1.0 - contact;
  // Часть прямого света под креслом тоже перекрыта, но слабее: тени от солнца уже есть в сцене.
  reflectedLight.directDiffuse *= 1.0 - contact * 0.5;
}`);
      };
      material.customProgramCacheKey = () => 'concrete-contact';
      material.needsUpdate = true;
    },
  };
}
