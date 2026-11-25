import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import horizon from './horizon.json';
import surroundings from './surroundings.json';
import greenery from './greenery.json';
import './style.css';

const initialHash = location.hash;
// Предрендеренные панорамы (вид из ближайшей точки сектора) отключены по умолчанию: вид с места строится живой сценой из самого кресла. Включить: ?pano=1.
const usePanoramas = new URLSearchParams(location.search).get('pano') === '1';
// Все ресурсы берутся относительно базового адреса сборки: работает и в подпапке (например, GitHub Pages).
const asset = (path) => import.meta.env.BASE_URL + path;
const canvas = document.querySelector('#stadium');
const introVideo = document.querySelector('#stadium-intro');
let renderer;
try {
  // Сглаживание краёв MSAA оставлено включённым для качества: замер показал выигрыш без него только около 1 мс (?aa=0 отключает для проверки).
  const antialias = new URLSearchParams(location.search).get('aa') !== '0';
  renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance' });
} catch (error) {
  document.querySelector('#error').hidden = false;
  throw error;
}
// Автоподбор качества: короткий замер видеокарты при запуске выбирает один из четырёх уровней (low, mid, high, max);
// во время работы разрешение дополнительно подстраивается под реальную частоту кадров. Принудительно: ?tier=low|mid|high|max (?quality=max то же, что tier=max).
// low — слабые телефоны, mid — хорошие телефоны и лёгкие ноутбуки, high — ноутбуки и компьютеры, max — съёмка и показ на мощном компьютере.
const touchDevice = window.matchMedia('(pointer: coarse)').matches;
function benchmarkGpu() {
  // Полноэкранный шейдер на маленькой текстуре: время на видеокарте без привязки к размеру окна.
  try {
    const size = 512;
    const target = new THREE.WebGLRenderTarget(size, size);
    const benchScene = new THREE.Scene();
    const benchCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: 'precision highp float;void main(){vec2 p=gl_FragCoord.xy/512.;float a=0.;for(int i=0;i<160;i++){a+=sin(p.x*float(i)+a)*cos(p.y*float(i)-a);}gl_FragColor=vec4(vec3(a),1.);}',
    });
    benchScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    const pixel = new Uint8Array(4);
    renderer.setRenderTarget(target);
    renderer.render(benchScene, benchCamera);
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
    const start = performance.now();
    for (let i = 0; i < 8; i += 1) renderer.render(benchScene, benchCamera);
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
    const ms = (performance.now() - start) / 8;
    renderer.setRenderTarget(null);
    target.dispose();
    material.dispose();
    return ms;
  } catch (error) {
    renderer.setRenderTarget(null);
    return null;
  }
}
function chooseTier() {
  const params = new URLSearchParams(location.search);
  const forced = params.get('tier') || (params.get('quality') === 'max' ? 'max' : '');
  if (['low', 'mid', 'high', 'max'].includes(forced)) return { tier: forced, ms: null };
  const ms = benchmarkGpu();
  let tier;
  if (ms === null) tier = touchDevice ? 'low' : 'high';
  else tier = ms < GPU_HIGH_MS ? 'high' : ms < GPU_MID_MS ? 'mid' : 'low';
  if (touchDevice && tier === 'high') tier = 'mid';   // телефоны не выше mid: нагрев и батарея
  return { tier, ms };
}
const GPU_HIGH_MS = 2.5;
const GPU_MID_MS = 14;
const tierInfo = chooseTier();
const tier = tierInfo.tier;
window.__tier = tierInfo;
const lowPower = tier === 'low';
const midTier = tier === 'mid';
const qualityMax = tier === 'max';
// Замер на Mac (Retina): обычный кадр 3–5 мс даже в 2×, а проход затенения GTAO добавляет 8–17 мс (он заново рисует всю сцену ради нормалей),
// поэтому по умолчанию GTAO выключен, а сэкономленное идёт на чёткость (разрешение до 2×). Затенение даёт запечённая карта.
let pixelRatio = Math.min(window.devicePixelRatio, lowPower ? 1.25 : midTier ? 1.75 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor('#a7c0c3', 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = qualityMax ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#a7c0c3');
const horizonPositions = [];
const horizonColors = [];
const horizonFaces = [];
const horizonScale = 6500 / 450;
const foothills = new THREE.Color('#657d83');
const rockyPeak = new THREE.Color('#768f98');
const snowyPeak = new THREE.Color('#d1d9d8');
for (let i = 0; i < horizon.length; i += 1) {
  const angle = i / horizon.length * Math.PI * 2;
  const x = Math.cos(angle) * 6500;
  const z = Math.sin(angle) * 6500;
  let slope = 0;
  let altitude = 0;
  for (let offset = -2; offset <= 2; offset += 1) {
    const sample = horizon[(i + offset + horizon.length) % horizon.length];
    const weight = 3 - Math.abs(offset);
    slope += sample[0] * weight / 9;
    altitude += sample[1] * weight / 9;
  }
  const height = (8 + slope * 450) * horizonScale;
  const snow = THREE.MathUtils.smoothstep(altitude, 3200, 4000) * 0.3;
  const peak = rockyPeak.clone().lerp(snowyPeak, snow);
  for (const [y, color] of [[-20 * horizonScale, foothills], [Math.max(0, height * 0.65), rockyPeak], [height, peak]]) {
    horizonPositions.push(x, y, z);
    horizonColors.push(color.r, color.g, color.b);
  }
  const next = (i + 1) % horizon.length;
  for (let level = 0; level < 2; level += 1) {
    const a = i * 3 + level;
    const b = next * 3 + level;
    horizonFaces.push(a, b, a + 1, b, b + 1, a + 1);
  }
}
const horizonGeometry = new THREE.BufferGeometry();
horizonGeometry.setAttribute('position', new THREE.Float32BufferAttribute(horizonPositions, 3));
horizonGeometry.setAttribute('color', new THREE.Float32BufferAttribute(horizonColors, 3));
horizonGeometry.setIndex(horizonFaces);
const horizonMesh = new THREE.Mesh(horizonGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
horizonMesh.layers.set(1);
scene.add(horizonMesh);

// Небо грузится в два шага: лёгкое 1k (1 МБ) сразу, а чёткое 2k (4 МБ) позже в фоне, когда сцена уже показана.
function applySky(texture) {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const previous = scene.background;
  scene.background = texture;
  scene.environment = texture;
  scene.environmentIntensity = scene.environmentIntensity || 0.45;
  if (previous && previous.isTexture && previous !== texture) previous.dispose();
  markDirty?.();
}
new HDRLoader().load(asset('sky.hdr'), (texture) => {
  applySky(texture);
  if (!lowPower && !midTier) setTimeout(() => new HDRLoader().load(asset('sky-2k.hdr'), applySky, undefined, () => {}), 3000);
}, undefined, (error) => console.error('Не удалось загрузить небо', error));
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 7500);
camera.layers.enable(1);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 90;
controls.maxDistance = 560;
controls.maxPolarAngle = Math.PI / 2.2;
controls.target.set(0, 4, 0);
const hemisphere = new THREE.HemisphereLight('#f4f1e2', '#4a5c5a', 0.75);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight('#fff0d0', 2.6);
sun.position.set(-85, 140, -70);
sun.castShadow = true;
const shadowSize = lowPower ? 2048 : midTier ? 3072 : qualityMax ? Math.min(8192, renderer.capabilities.maxTextureSize) : 4096;
sun.shadow.mapSize.set(shadowSize, shadowSize);
sun.shadow.radius = 2.5;
sun.shadow.camera.left = -135;
sun.shadow.camera.right = 135;
sun.shadow.camera.top = 115;
sun.shadow.camera.bottom = -115;
sun.shadow.camera.far = 350;
sun.shadow.bias = -0.0002;
scene.add(sun);

const material = (color, roughness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness });
const grassTexture = new THREE.TextureLoader().load(asset('sports-turf.webp'), undefined, undefined, (error) => console.error('Не удалось загрузить текстуру газона', error));
grassTexture.colorSpace = THREE.SRGBColorSpace;
grassTexture.wrapS = THREE.RepeatWrapping;
grassTexture.wrapT = THREE.RepeatWrapping;
grassTexture.repeat.set(25, 16);
grassTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
const grass = new THREE.MeshStandardMaterial({ map: grassTexture, roughness: 1 });
// Газон: ambientCG Grass004 (CC0) — нормали и шероховатость только на компьютерах.
if (!lowPower) {
  const grassDetail = (file) => {
    const texture = new THREE.TextureLoader().load(asset(file), undefined, undefined, (error) => console.error('Не удалось загрузить фактуру газона', file, error));
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(70, 45);
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    return texture;
  };
  grass.normalMap = grassDetail('grass-normal.webp');
  grass.normalScale.set(0.7, 0.7);
  // Карта шероховатости не используется: на газоне она давала блики от прожекторов вечером.
}
// Бетон: Poly Haven «Damaged Concrete Floor» (CC0) — цвет, нормали и шероховатость; на телефонах только цвет.
const textureLoader = new THREE.TextureLoader();
function concreteMap(file, color = false) {
  const texture = textureLoader.load(file, undefined, undefined, (error) => console.error('Не удалось загрузить текстуру бетона', file, error));
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 2);
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  return texture;
}
const concreteTexture = concreteMap(asset('concrete-diff.webp'), true);
const concreteExtras = lowPower ? {} : { normalMap: concreteMap(asset('concrete-normal.webp')), normalScale: new THREE.Vector2(0.35, 0.35), roughnessMap: concreteMap(asset('concrete-rough.webp')) };
const concrete = new THREE.MeshStandardMaterial({ color: '#d6d9d3', map: concreteTexture, roughness: 1, ...concreteExtras });
const darkConcrete = new THREE.MeshStandardMaterial({ color: '#bcc2bc', map: concreteTexture, roughness: 1, ...concreteExtras });
// Выцветание и разводы бетона: шум по мировым координатам, без отдельных текстур.
// Запечённое затенение (Blender Cycles, вид сверху): карта по мировым координатам (x, z). Применяется к бетону, дорожкам, газону и земле.
// Карта покрывает x in [-112, 112], z in [-96, 96]; на телефонах версия вдвое меньше.
const aoTexture = textureLoader.load(asset(lowPower || midTier ? 'ao-top-2k.webp' : 'ao-top.webp'), undefined, undefined, () => {});
aoTexture.colorSpace = THREE.SRGBColorSpace;
aoTexture.anisotropy = 4;
// Вечерний свет прожекторов, запечённый в Blender (work/blender/bake_floodlight_topdown.py), на той же области; 0 днём.
// Карта вечернего света грузится только при первом включении вечера (в обычном заходе она не нужна).
const lightTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
lightTexture.needsUpdate = true;
let eveningLightLoaded = false;
function loadEveningLight() {
  if (eveningLightLoaded) return;
  eveningLightLoaded = true;
  textureLoader.load(asset('light-evening.webp'), (texture) => {
    texture.anisotropy = 4;
    aoUniforms.uLightMap.value = texture;
    markDirty();
  }, undefined, () => {});
}
const aoUniforms = {
  uAoMap: { value: aoTexture },
  uLightMap: { value: lightTexture },
  uLightAmount: { value: 0 },
  uAoRect: { value: new THREE.Vector4(-125, -105, 250, 210) },
  uAoStrength: { value: 0.6 },
};
function weather(surface, { stains = true, ao = 0.6 } = {}) {
  surface.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, aoUniforms, { uAoStrength: { value: ao } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWeatherPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\nvWeatherPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvWeatherPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWeatherPos;
uniform sampler2D uAoMap;
uniform sampler2D uLightMap;
uniform float uLightAmount;
uniform vec4 uAoRect;
uniform float uAoStrength;
float wHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float wNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wHash(i), wHash(i + vec3(1,0,0)), f.x), mix(wHash(i + vec3(0,1,0)), wHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wHash(i + vec3(0,0,1)), wHash(i + vec3(1,0,1)), f.x), mix(wHash(i + vec3(0,1,1)), wHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uLightAmount > 0.0) {
  vec2 lightUv = vec2((vWeatherPos.x - uAoRect.x) / uAoRect.z, 1.0 - (vWeatherPos.z - uAoRect.y) / uAoRect.w);
  float bakedLight = texture2D(uLightMap, lightUv).r;
  totalEmissiveRadiance += diffuseColor.rgb * bakedLight * uLightAmount * vec3(1.0, 0.93, 0.78);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${!stains ? '' : lowPower
  ? 'float stain = wNoise(vWeatherPos * 0.35) * 0.7 + wNoise(vWeatherPos * 1.7) * 0.3;\ndiffuseColor.rgb *= mix(0.72, 1.08, stain);'
  : `float stain = wNoise(vWeatherPos * 0.35);
// Издали мелкие разводы плавно уходят (без резкой границы): один отсчёт шума вместо пяти.
float stainFar = smoothstep(110.0, 170.0, length(vViewPosition));
vec3 stainBase = diffuseColor.rgb;
diffuseColor.rgb *= mix(0.72, 1.08, stain);
if (stainFar < 1.0) {
  float stainFull = stain * 0.6 + wNoise(vWeatherPos * 1.7) * 0.3 + wNoise(vWeatherPos * 7.0) * 0.1;
  vec3 stainColor = stainBase * mix(0.72, 1.08, stainFull);
  stainColor = mix(stainColor, stainColor * vec3(0.86, 0.9, 0.84), smoothstep(0.55, 0.8, wNoise(vWeatherPos * 0.9)));
  diffuseColor.rgb = mix(stainColor, diffuseColor.rgb, stainFar);
}`}
vec2 aoUv = vec2((vWeatherPos.x - uAoRect.x) / uAoRect.z, 1.0 - (vWeatherPos.z - uAoRect.y) / uAoRect.w);
float bakedAo = texture2D(uAoMap, aoUv).r;
diffuseColor.rgb *= mix(1.0, bakedAo, uAoStrength);
// Вертикальные грани (подступенки) темнее горизонтальных: ступени читаются как ступени.
vec3 faceNormal = normalize(cross(dFdx(vWeatherPos), dFdy(vWeatherPos)));
diffuseColor.rgb *= mix(0.8, 1.0, smoothstep(0.25, 0.75, abs(faceNormal.y)));`);
  };
  surface.needsUpdate = true;
}
weather(concrete);
weather(darkConcrete);
weather(grass, { stains: false });
const trackNormal = new THREE.TextureLoader().load(asset('track-normal.jpg'), undefined, undefined, (error) => console.error('Не удалось загрузить фактуру дорожек', error));
trackNormal.wrapS = THREE.RepeatWrapping;
trackNormal.wrapT = THREE.RepeatWrapping;
trackNormal.repeat.set(0.5, 0.5);
trackNormal.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
const track = new THREE.MeshStandardMaterial({ color: '#405a70', roughness: 0.95, normalMap: trackNormal, normalScale: new THREE.Vector2(0.5, 0.5) });
weather(track, { stains: false });
const white = material('#e8ead9');
// Пластик кресел: на компьютерах с глянцевым лаковым слоем, ловит отражения неба.
const seatMaterial = (color) => (qualityMax
  ? new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.28 })
  : material(color, 0.5));
const yellowSeats = seatMaterial('#e0a617');
const blueSeats = seatMaterial('#1f5fa8');
const greenSeats = seatMaterial('#2f8f6a');
// Кресла тоже получают запечённое затенение по месту установки (слабее, чтобы не считать тень кресла дважды).
for (const seatMaterial of [yellowSeats, blueSeats, greenSeats]) weather(seatMaterial, { stains: false, ao: 0.35 });
const steel = qualityMax ? new THREE.MeshStandardMaterial({ color: '#d8dbd2', roughness: 0.38, metalness: 0.7 }) : material('#d8dbd2', 0.55);

const buildingRoofs = [];
const buildingWalls = [];
for (const [height, footprint] of surroundings) {
  const shape = new THREE.Shape();
  shape.moveTo(footprint[0][0], -footprint[0][1]);
  for (const [x, z] of footprint.slice(1)) shape.lineTo(x, -z);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  for (const group of geometry.groups) {
    const part = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const start = group.start * attribute.itemSize;
      const end = (group.start + group.count) * attribute.itemSize;
      part.setAttribute(name, new THREE.BufferAttribute(attribute.array.slice(start, end), attribute.itemSize));
    }
    (group.materialIndex === 0 ? buildingRoofs : buildingWalls).push(part);
  }
  geometry.dispose();
}
const facadeCanvas = document.createElement('canvas');
facadeCanvas.width = 64;
facadeCanvas.height = 64;
const facade = facadeCanvas.getContext('2d');
facade.fillStyle = '#aaa9a1';
facade.fillRect(0, 0, 64, 64);
facade.fillStyle = '#657475';
facade.fillRect(12, 10, 40, 38);
facade.fillStyle = '#949f9b';
facade.fillRect(30, 10, 4, 38);
facade.fillRect(12, 29, 40, 3);
const facadeTexture = new THREE.CanvasTexture(facadeCanvas);
facadeTexture.colorSpace = THREE.SRGBColorSpace;
facadeTexture.wrapS = THREE.RepeatWrapping;
facadeTexture.wrapT = THREE.RepeatWrapping;
facadeTexture.repeat.set(0.28, 0.28);
scene.add(new THREE.Mesh(mergeGeometries(buildingRoofs), material('#969991')));
scene.add(new THREE.Mesh(mergeGeometries(buildingWalls), new THREE.MeshStandardMaterial({ map: facadeTexture, roughness: 0.95 })));
for (const geometry of [...buildingRoofs, ...buildingWalls]) geometry.dispose();
const greenGeometries = greenery.map((footprint) => {
  const shape = new THREE.Shape();
  shape.moveTo(footprint[0][0], -footprint[0][1]);
  for (const [x, z] of footprint.slice(1)) shape.lineTo(x, -z);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -0.15, 0);
  return geometry;
});
const greenMaterial = material('#4d6a45');
weather(greenMaterial);
scene.add(new THREE.Mesh(mergeGeometries(greenGeometries), greenMaterial));
greenGeometries.forEach((geometry) => geometry.dispose());
// Деревья на зелёных участках: случайная, но воспроизводимая расстановка (породы и высоты условные).
{
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const inside = (x, z, polygon) => {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, zi] = polygon[i];
      const [xj, zj] = polygon[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) result = !result;
    }
    return result;
  };
  const treePoints = [];
  for (const polygon of greenery) {
    const xs = polygon.map((point) => point[0]);
    const zs = polygon.map((point) => point[1]);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const attempts = Math.min(400, Math.ceil((maxX - minX) * (maxZ - minZ) / 220));
    for (let i = 0; i < attempts; i += 1) {
      const x = minX + random() * (maxX - minX);
      const z = minZ + random() * (maxZ - minZ);
      if (Math.abs(x) < 125 && Math.abs(z) < 105) continue;
      if (inside(x, z, polygon)) treePoints.push([x, z]);
    }
  }
  const crownGeometry = new THREE.IcosahedronGeometry(1, 1);
  crownGeometry.translate(0, 1, 0);
  const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.18, 1, 5);
  trunkGeometry.translate(0, 0.5, 0);
  const crowns = new THREE.InstancedMesh(crownGeometry, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), treePoints.length);
  const trunks = new THREE.InstancedMesh(trunkGeometry, material('#5a4a3a', 1), treePoints.length);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  treePoints.forEach(([x, z], index) => {
    const height = 6 + random() * 7;
    const crown = 2.2 + random() * 1.8;
    dummy.position.set(x, -0.15, z);
    dummy.rotation.set(0, random() * 6.28, 0);
    dummy.scale.set(0.5, height * 0.45, 0.5);
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);
    dummy.position.y = height * 0.35;
    dummy.scale.set(crown, crown * 1.25, crown);
    dummy.updateMatrix();
    crowns.setMatrixAt(index, dummy.matrix);
    crowns.setColorAt(index, tint.setHSL(0.24 + random() * 0.07, 0.38, 0.2 + random() * 0.1));
  });
  crowns.castShadow = true;
  trunks.castShadow = true;
  scene.add(crowns, trunks);
}


function box(width, height, depth, x, y, z, surface) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), surface);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// Чаша увеличена до 227 × 175 м (по данным OpenStreetMap): трибуны растягиваются по x и z, поле и дорожки остаются прежними,
// кресла, ступени и высоты не меняются. Тот же масштаб использует work/blender/create_scaled_bowl.py.
const bowlOuterHalfX = 71.6 + 33 * 0.72 + 2;
const bowlOuterHalfZ = 53.6 + 33 * 0.72 + 2;
const bowlScaleX = 227 / (2 * bowlOuterHalfX);
const bowlScaleZ = 175 / (2 * bowlOuterHalfZ);
function roundedPath(halfWidth, halfDepth, radius, path = new THREE.Path(), sx = 1, sz = 1) {
  path.moveTo((-halfWidth + radius) * sx, -halfDepth * sz);
  path.lineTo((halfWidth - radius) * sx, -halfDepth * sz);
  path.quadraticCurveTo(halfWidth * sx, -halfDepth * sz, halfWidth * sx, (-halfDepth + radius) * sz);
  path.lineTo(halfWidth * sx, (halfDepth - radius) * sz);
  path.quadraticCurveTo(halfWidth * sx, halfDepth * sz, (halfWidth - radius) * sx, halfDepth * sz);
  path.lineTo((-halfWidth + radius) * sx, halfDepth * sz);
  path.quadraticCurveTo(-halfWidth * sx, halfDepth * sz, -halfWidth * sx, (halfDepth - radius) * sz);
  path.lineTo(-halfWidth * sx, (-halfDepth + radius) * sz);
  path.quadraticCurveTo(-halfWidth * sx, -halfDepth * sz, (-halfWidth + radius) * sx, -halfDepth * sz);
  return path;
}

// scale: 0 — без изменений, 1 — увеличивается только внешний контур, 2 — внешний и внутренний (трибуны и барьер).
function ring(outerWidth, outerDepth, innerWidth, innerDepth, radius, height, surface, thickness = 0, scale = 0) {
  const shape = roundedPath(outerWidth, outerDepth, radius, new THREE.Shape(), scale >= 1 ? bowlScaleX : 1, scale >= 1 ? bowlScaleZ : 1);
  shape.holes.push(roundedPath(innerWidth, innerDepth, Math.max(radius - (outerWidth - innerWidth), 1), new THREE.Path(), scale === 2 ? bowlScaleX : 1, scale === 2 ? bowlScaleZ : 1));
  const geometry = thickness
    ? new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 12 })
    : new THREE.ShapeGeometry(shape, 16);
  const mesh = new THREE.Mesh(geometry, surface);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = height - thickness;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// Геометрия чаши и места являются ориентировочными, а не измеренным планом.
const groundMaterial = material('#7d8873');
weather(groundMaterial);
box(850, 0.5, 850, 0, -0.5, 0, groundMaterial);
// Мягкая тень-«посадка» стадиона на землю: тёмный градиент вокруг чаши.
{
  const contactCanvas = document.createElement('canvas');
  contactCanvas.width = 256;
  contactCanvas.height = 256;
  const contactContext = contactCanvas.getContext('2d');
  contactContext.translate(128, 128);
  contactContext.scale(1, 0.82);
  const contactGradient = contactContext.createRadialGradient(0, 0, 70, 0, 0, 128);
  contactGradient.addColorStop(0, 'rgba(20,28,22,0.55)');
  contactGradient.addColorStop(0.55, 'rgba(20,28,22,0.3)');
  contactGradient.addColorStop(1, 'rgba(20,28,22,0)');
  contactContext.fillStyle = contactGradient;
  contactContext.fillRect(-128, -156, 256, 312);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(330 * bowlScaleX, 270 * bowlScaleZ), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(contactCanvas), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = -0.2;
  scene.add(contact);
}
const farGround = new THREE.Mesh(new THREE.CircleGeometry(6500, 48), material('#6e7a66', 1));
farGround.rotation.x = -Math.PI / 2;
farGround.position.y = -0.8;
scene.add(farGround);
box(105, 0.12, 68, 0, 0, 0, grass);
const mowingShade = new THREE.MeshBasicMaterial({ color: '#1c452c', transparent: true, opacity: 0.12, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
for (let strip = 0; strip < 5; strip += 1) {
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 68), mowingShade);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(-47.25 + strip * 21, 0.071, 0);
  scene.add(stripe);
}
// Потёртости газона у ворот и в центре: мягкие тёмные пятна.
const wearCanvas = document.createElement('canvas');
wearCanvas.width = 128;
wearCanvas.height = 128;
const wearContext = wearCanvas.getContext('2d');
const wearGradient = wearContext.createRadialGradient(64, 64, 4, 64, 64, 62);
wearGradient.addColorStop(0, 'rgba(48,50,24,0.5)');
wearGradient.addColorStop(0.6, 'rgba(48,50,24,0.22)');
wearGradient.addColorStop(1, 'rgba(48,50,24,0)');
wearContext.fillStyle = wearGradient;
wearContext.fillRect(0, 0, 128, 128);
const wearMaterial = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(wearCanvas), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
for (const [x, z, width, depth] of [[-49, 0, 12, 20], [49, 0, 12, 20], [0, 0, 14, 14], [-30, 18, 10, 8], [28, -16, 10, 8]]) {
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), wearMaterial);
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(x, 0.085, z);
  scene.add(patch);
}
function line(x1, z1, x2, z2, width = 0.18) {
  const length = Math.hypot(x2 - x1, z2 - z1);
  const mesh = box(length, 0.025, width, (x1 + x2) / 2, 0.11, (z1 + z2) / 2, white);
  mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
}
line(-52.5, -34, 52.5, -34); line(-52.5, 34, 52.5, 34);
line(-52.5, -34, -52.5, 34); line(52.5, -34, 52.5, 34);
line(0, -34, 0, 34);
line(-52.5, -20, -36, -20); line(-36, -20, -36, 20); line(-36, 20, -52.5, 20);
line(52.5, -20, 36, -20); line(36, -20, 36, 20); line(36, 20, 52.5, 20);
line(-52.5, -9, -47, -9); line(-47, -9, -47, 9); line(-47, 9, -52.5, 9);
line(52.5, -9, 47, -9); line(47, -9, 47, 9); line(47, 9, 52.5, 9);
const circle = new THREE.Mesh(new THREE.RingGeometry(9, 9.16, 64), white);
circle.rotation.x = -Math.PI / 2;
circle.position.y = 0.12;
scene.add(circle);
// Пенальти: точки и дуги штрафной (размеры по правилам, 11 м и 9,15 м).
const arcSpan = Math.acos(5.5 / 9.15);
for (const side of [-1, 1]) {
  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), white);
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(side * 41.5, 0.125, 0);
  scene.add(spot);
  const arc = new THREE.Mesh(new THREE.RingGeometry(9.0, 9.16, 40, 1, side < 0 ? -arcSpan : Math.PI - arcSpan, arcSpan * 2), white);
  arc.rotation.x = -Math.PI / 2;
  arc.position.set(side * 41.5, 0.125, 0);
  scene.add(arc);
}
const centerSpot = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), white);
centerSpot.rotation.x = -Math.PI / 2;
centerSpot.position.y = 0.125;
scene.add(centerSpot);


const cornerFlags = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Ворота, угловые флажки и рекламные борта (размеры стандартные, раскраска условная).
for (const side of [-1, 1]) {
  const x = side * 52.5;
  for (const z of [-3.66, 3.66]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8), white);
    post.position.set(x, 1.22, z);
    post.castShadow = true;
    scene.add(post);
  }
  const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32, 8), white);
  crossbar.rotation.x = Math.PI / 2;
  crossbar.position.set(x, 2.44, 0);
  crossbar.castShadow = true;
  scene.add(crossbar);
  const netLines = [];
  for (let z = -3.6; z <= 3.61; z += 0.6) netLines.push(x, 2.44, z, x + side * 2, 0.1, z);
  for (let y = 0.5; y <= 2.4; y += 0.45) netLines.push(x + side * (2 - y / 2.44 * 2), y, -3.66, x + side * (2 - y / 2.44 * 2), y, 3.66);
  const netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute('position', new THREE.Float32BufferAttribute(netLines, 3));
  scene.add(new THREE.LineSegments(netGeometry, new THREE.LineBasicMaterial({ color: '#e4ebe5', transparent: true, opacity: 0.7 })));
  for (const z of [-34, 34]) {
    const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6), white);
    flagPole.position.set(x, 0.8, z);
    scene.add(flagPole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.3), new THREE.MeshBasicMaterial({ color: '#e0a617', side: THREE.DoubleSide }));
    flag.position.set(x - side * 0.18, 1.45, z);
    flag.userData.phase = cornerFlags.length * 1.7;
    cornerFlags.push(flag);
    scene.add(flag);
  }
}
const boardCanvas = document.createElement('canvas');
boardCanvas.width = 1024;
boardCanvas.height = 64;
const boardContext = boardCanvas.getContext('2d');
['#1f5fa8', '#f1f1ea', '#c9362f', '#e0a617', '#1d2a33', '#2f8f6a'].forEach((color, index) => {
  boardContext.fillStyle = color;
  boardContext.fillRect(index * 170.67, 0, 171, 64);
  boardContext.fillStyle = color === '#f1f1ea' ? '#1d2a33' : '#f1f1ea';
  boardContext.fillRect(index * 170.67 + 30, 28, 110, 8);
});
const boardTexture = new THREE.CanvasTexture(boardCanvas);
boardTexture.colorSpace = THREE.SRGBColorSpace;
boardTexture.wrapS = THREE.RepeatWrapping;
const boardMaterial = new THREE.MeshStandardMaterial({ map: boardTexture, roughness: 0.55, emissive: '#ffffff', emissiveMap: boardTexture, emissiveIntensity: 0.35 });
for (const [length, x, z, turn] of [[105, 0, -35.6, 0], [105, 0, 35.6, 0], [71, -54.4, 0, Math.PI / 2], [71, 54.4, 0, Math.PI / 2]]) {
  const texture = boardTexture.clone();
  texture.repeat.set(length / 17.5, 1);
  texture.needsUpdate = true;
  const board = new THREE.Mesh(new THREE.BoxGeometry(length, 0.9, 0.12), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0.35 }));
  board.position.set(x, 0.45, z);
  board.rotation.y = turn;
  board.castShadow = true;
  scene.add(board);
}

// Скамейки запасных на западной стороне поля (ориентировочно).
const dugoutGlass = new THREE.MeshStandardMaterial({ color: '#9fc4cf', transparent: true, opacity: 0.28, roughness: 0.1, depthWrite: false });
const dugoutFrame = material('#2a3236', 0.5);
const dugoutSeat = material('#c9362f', 0.6);
for (const x of [-10, 10]) {
  const z = -38.4;
  const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(7, 0.08, 1.6), dugoutGlass);
  roofPanel.position.set(x, 2.1, z);
  const back = new THREE.Mesh(new THREE.BoxGeometry(7, 1.9, 0.05), dugoutGlass);
  back.position.set(x, 1.1, z - 0.8);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.08, 0.4), dugoutSeat);
  bench.position.set(x, 0.42, z - 0.4);
  const backrest = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.4, 0.06), dugoutSeat);
  backrest.position.set(x, 0.72, z - 0.62);
  scene.add(roofPanel, back, bench, backrest);
  for (const dx of [-3.5, 3.5]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), dugoutFrame);
    post.position.set(x + dx, 1.05, z + 0.75);
    post.castShadow = true;
    scene.add(post);
    const postBack = post.clone();
    postBack.position.z = z - 0.78;
    scene.add(postBack);
  }
  roofPanel.castShadow = true;
}
ring(70, 52, 54, 35, 29, 0.02, darkConcrete, 0, 1);
ring(65, 46, 54, 35, 26, 0.04, track);
for (let i = 0; i <= 8; i += 1) {
  ring(55 + i * 1.22, 36 + i * 1.22, 54.94 + i * 1.22, 35.94 + i * 1.22, 16 + i * 1.22, 0.07, white);
}
ring(94, 76, 69, 51, 38, 0.02, darkConcrete, 0, 2);
// Номера дорожек и финишная линия на западной прямой (расположение ориентировочное).
for (let lane = 0; lane < 8; lane += 1) {
  const numberCanvas = document.createElement('canvas');
  numberCanvas.width = 128;
  numberCanvas.height = 128;
  const numberContext = numberCanvas.getContext('2d');
  numberContext.fillStyle = '#f4f1e2';
  numberContext.font = '700 100px system-ui, sans-serif';
  numberContext.textAlign = 'center';
  numberContext.textBaseline = 'middle';
  numberContext.fillText(String(lane + 1), 64, 70);
  const numberTexture = new THREE.CanvasTexture(numberCanvas);
  numberTexture.colorSpace = THREE.SRGBColorSpace;
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: numberTexture, transparent: true, depthWrite: false }));
  mark.rotation.x = -Math.PI / 2;
  mark.rotation.z = Math.PI / 2;
  mark.position.set(-28, 0.095, -(36.61 + lane * 1.22));
  scene.add(mark);
}
const finishCanvas = document.createElement('canvas');
finishCanvas.width = 16;
finishCanvas.height = 128;
const finishContext = finishCanvas.getContext('2d');
for (let i = 0; i < 16; i += 1) {
  finishContext.fillStyle = i % 2 ? '#f4f1e2' : '#14181a';
  finishContext.fillRect(0, i * 8, 8, 8);
  finishContext.fillStyle = i % 2 ? '#14181a' : '#f4f1e2';
  finishContext.fillRect(8, i * 8, 8, 8);
}
const finishTexture = new THREE.CanvasTexture(finishCanvas);
finishTexture.colorSpace = THREE.SRGBColorSpace;
finishTexture.magFilter = THREE.NearestFilter;
const finish = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 9.76), new THREE.MeshBasicMaterial({ map: finishTexture }));
finish.rotation.x = -Math.PI / 2;
finish.position.set(30, 0.095, -40.9);
scene.add(finish);


// Барьер перед первым рядом: бетонный парапет и тонкая светодиодная лента (размеры ориентировочные).
ring(70.7, 52.7, 70.4, 52.4, 29.3, 0.95, darkConcrete, 0.95, 2);
ring(70.4, 52.4, 70.38, 52.38, 29.0, 0.4, new THREE.MeshBasicMaterial({ color: '#4c9bff' }), 0.07, 2);
ring(70.72, 52.72, 70.4, 52.4, 29.32, 1.0, steel, 0.05, 2);

const rows = 34;
const seatsPerRow = 800;
const standLevels = [];
const aisles = Array.from({ length: 8 }, () => []);
const aisleSteps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.04, 0.68), concrete, rows * aisles.length);
const seatShape = new THREE.Shape();
seatShape.moveTo(-0.23, -0.2);
seatShape.lineTo(0.23, -0.2);
seatShape.quadraticCurveTo(0.26, -0.2, 0.26, -0.14);
seatShape.lineTo(0.23, 0.2);
seatShape.lineTo(-0.23, 0.2);
seatShape.lineTo(-0.26, -0.14);
seatShape.quadraticCurveTo(-0.26, -0.2, -0.23, -0.2);
const seatBase = new THREE.ExtrudeGeometry(seatShape, { depth: 0.05, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 2 });
seatBase.rotateX(-Math.PI / 2);
const backShape = new THREE.Shape();
backShape.moveTo(-0.22, 0);
backShape.lineTo(0.22, 0);
backShape.lineTo(0.24, 0.43);
backShape.quadraticCurveTo(0.24, 0.5, 0.17, 0.5);
backShape.lineTo(-0.17, 0.5);
backShape.quadraticCurveTo(-0.24, 0.5, -0.24, 0.43);
backShape.lineTo(-0.22, 0);
const seatBack = new THREE.ExtrudeGeometry(backShape, { depth: 0.05, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.02, bevelThickness: 0.02, curveSegments: 2 });
seatBack.rotateX(-0.12);
seatBack.translate(0, 0.04, 0.18);
const seatGeometry = mergeGeometries([seatBase, seatBack]);
seatBase.dispose();
seatBack.dispose();
// Упрощённое кресло (36 треугольников) для общего вида; детальное (около 200) показывается только вблизи.
const lowBase = new THREE.BoxGeometry(0.5, 0.07, 0.42);
lowBase.translate(0, 0.035, 0);
const lowBack = new THREE.BoxGeometry(0.47, 0.5, 0.07);
lowBack.rotateX(-0.12);
lowBack.translate(0, 0.3, 0.2);
const lowLeg = new THREE.BoxGeometry(0.09, 0.25, 0.12);
lowLeg.translate(0, -0.15, 0.08);
const lowSeatGeometry = mergeGeometries([lowBase, lowBack, lowLeg]);
[lowBase, lowBack, lowLeg].forEach((part) => part.dispose());
const yellow = new THREE.InstancedMesh(lowSeatGeometry, yellowSeats, rows * seatsPerRow);
const blue = new THREE.InstancedMesh(lowSeatGeometry, blueSeats, rows * seatsPerRow);
const green = new THREE.InstancedMesh(lowSeatGeometry, greenSeats, rows * seatsPerRow);
const modelLoader = new GLTFLoader();
// Горы подгружаются чуть позже первого кадра: стадион появляется быстрее, особенно на телефоне.
setTimeout(() => {
  modelLoader.load(asset('alatau-terrain.glb'), (model) => {
    model.scene.traverse((object) => {
      if (object.isMesh) object.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
      object.layers.set(1);
    });
    scene.add(model.scene);
  }, undefined, (error) => console.error('Не удалось загрузить рельеф гор:', error));
}, 1500);
modelLoader.load(asset('stadium-seat.glb'), (model) => {
  const seat = model.scene.getObjectByName('Stadium_seat');
  if (!seat?.isMesh) {
    console.error('The stadium seat model does not contain a seat mesh.');
    return;
  }
  const previous = detailSeatGeometry;
  detailSeatGeometry = seat.geometry;
  for (const mesh of Object.values(detailMeshes)) mesh.geometry = detailSeatGeometry;
  previous.dispose();
}, undefined, (error) => console.error('Could not load the stadium seat model:', error));
yellow.castShadow = true;
blue.castShadow = true;
green.castShadow = true;
const hitGeometry = new THREE.BoxGeometry(0.7, 0.75, 0.85);
hitGeometry.translate(0, 0.22, 0);
const seatHits = new THREE.InstancedMesh(hitGeometry, new THREE.MeshBasicMaterial(), rows * seatsPerRow);
seatHits.visible = false;
const supportGeometry = new THREE.BoxGeometry(0.09, 0.25, 0.12);
supportGeometry.translate(0, -0.15, 0.08);
// Детальные кресла вблизи: отдельные небольшие меши только для нужных мест (сектор или окрестность кресла).
const detailCapacity = lowPower ? 3200 : midTier ? 5000 : qualityMax ? 14000 : 7000;
const detailRadius = lowPower ? 28 : midTier ? 38 : qualityMax ? 72 : 48;
let detailSeatGeometry = seatGeometry;
const detailMeshes = {
  yellow: new THREE.InstancedMesh(seatGeometry, yellowSeats, detailCapacity),
  blue: new THREE.InstancedMesh(seatGeometry, blueSeats, detailCapacity),
  green: new THREE.InstancedMesh(seatGeometry, greenSeats, detailCapacity),
};
// Три уровня кресла: рядом (до 20 м) подробная модель из stadium-seat.glb, дальше упрощённая (около 200 треугольников), ещё дальше простые кубики.
const nearDetailRadius = lowPower ? 14 : midTier ? 17 : qualityMax ? 30 : 20;
const detailMid = {
  yellow: new THREE.InstancedMesh(seatGeometry, yellowSeats, detailCapacity),
  blue: new THREE.InstancedMesh(seatGeometry, blueSeats, detailCapacity),
  green: new THREE.InstancedMesh(seatGeometry, greenSeats, detailCapacity),
};
const detailLegs = new THREE.InstancedMesh(supportGeometry, material('#59645e', 0.75), detailCapacity * 3);
const sectorHits = new THREE.InstancedMesh(hitGeometry, new THREE.MeshBasicMaterial(), detailCapacity * 3);
sectorHits.visible = false;
const sectorRefs = [];
for (const mesh of [...Object.values(detailMeshes), ...Object.values(detailMid), detailLegs, sectorHits]) {
  mesh.count = 0;
  mesh.frustumCulled = false;
}
scene.add(...Object.values(detailMeshes), ...Object.values(detailMid), detailLegs, sectorHits);
const helper = new THREE.Object3D();
const yellowData = [];
const blueData = [];
const greenData = [];
const seats = [];
let yellowCount = 0;
let blueCount = 0;
let greenCount = 0;
for (let row = 0; row < rows; row += 1) {
  const step = row * 0.72 + (row >= 15 ? 2 : 0);
  const y = 0.45 + row * 0.37;
  if (row === 15) ring(83.68, 65.68, 81.68, 63.68, 41.58, y - 0.37, darkConcrete, 0.38, 2);
  standLevels.push(ring(71.6 + step, 53.6 + step, 70.88 + step, 52.88 + step, 29.5 + step, y, row % 2 ? concrete : darkConcrete, 0.38, 2));
  const path = roundedPath(71 + step, 53 + step, 29 + step, new THREE.Path(), bowlScaleX, bowlScaleZ);
  const points = path.getSpacedPoints(seatsPerRow);
  for (let aisle = 0; aisle < aisles.length; aisle += 1) {
    const first = points[aisle * 100];
    const point = points[aisle * 100 + 2];
    const end = points[aisle * 100 + 4];
    aisles[aisle].push(new THREE.Vector3(point.x, y + 0.35, -point.y));
    const outward = new THREE.Vector2(point.x, point.y).normalize();
    helper.position.set(point.x + outward.x * 0.24, y + 0.02, -point.y - outward.y * 0.24);
    helper.rotation.set(0, Math.atan2(end.y - first.y, end.x - first.x), 0);
    helper.scale.set(first.distanceTo(end) * 0.85, 1, 1);
    helper.updateMatrix();
    aisleSteps.setMatrixAt(row * aisles.length + aisle, helper.matrix);
  }
  helper.scale.set(1, 1, 1);
  for (let i = 0; i < seatsPerRow; i += 1) {
    if (i % 100 < 4) continue;
    const point = points[i];
    const next = points[i + 1];
    helper.position.set(point.x, y + 0.27, -point.y);
    helper.rotation.set(0, Math.atan2(next.y - point.y, next.x - point.x), 0);
    helper.updateMatrix();
    const stand = Math.abs(point.x) / ((71 + step) * bowlScaleX) > Math.abs(point.y) / ((53 + step) * bowlScaleZ)
      ? (point.x > 0 ? 'north' : 'south')
      : (point.y > 0 ? 'west' : 'east');
    if (stand === 'east' && (row === 13 || row === 14)) continue;
    if (stand === 'west' && Math.abs(point.x) < 12.5 * bowlScaleX && point.y > 72.5 * bowlScaleZ) continue;
    const seat = { stand, row: row + 1, position: helper.position.clone(), matrix: helper.matrix.clone() };
    seatHits.setMatrixAt(seats.length, helper.matrix);
    seats.push(seat);
    if ((stand === 'east' && row < 13) || (stand === 'south' && Math.floor(i / 16) % 2 === 0)) {
      green.setMatrixAt(greenCount++, helper.matrix);
      seat.group = 'green';
      greenData.push(seat);
    } else if (((stand === 'east' || stand === 'west') && row >= 15) || (stand === 'north' && Math.floor(i / 16) % 3 === 0)) {
      blue.setMatrixAt(blueCount++, helper.matrix);
      seat.group = 'blue';
      blueData.push(seat);
    } else {
      yellow.setMatrixAt(yellowCount++, helper.matrix);
      seat.group = 'yellow';
      yellowData.push(seat);
    }
  }
}
const standSectors = {
  west: Array.from({ length: 17 }, (_, index) => index + 1),
  north: Array.from({ length: 11 }, (_, index) => index + 18),
  east: [...Array.from({ length: 8 }, (_, index) => index + 30), ...Array.from({ length: 9 }, (_, index) => index + 40)],
  south: Array.from({ length: 12 }, (_, index) => index + 49),
};
for (const [stand, sectors] of Object.entries(standSectors)) {
  for (let row = 1; row <= rows; row += 1) {
    const rowSeats = seats.filter((seat) => seat.stand === stand && seat.row === row);
    // Обход ряда начинается внутри восточной трибуны, поэтому её места в списке идут не подряд (середина, потом левый край);
    // без сортировки один сектор забирал места с двух концов трибуны. Порядок мест по x (слева направо) делает сектора цельными.
    if (stand === 'east') rowSeats.sort((a, b) => a.position.x - b.position.x);
    const rowSectors = stand === 'east' ? (row <= 13 ? sectors.slice(0, 8) : sectors.slice(8))
      : stand === 'west' ? (row <= 15 ? sectors.slice(0, 9) : sectors.slice(9)) : sectors;
    const numbers = new Map();
    rowSeats.forEach((seat, index) => {
      seat.sector = rowSectors[Math.floor(index * rowSectors.length / rowSeats.length)];
      if ((stand === 'east' || stand === 'west') && row > 15) seat.row -= 15;
      seat.number = (numbers.get(seat.sector) || 0) + 1;
      numbers.set(seat.sector, seat.number);
    });
  }
}
// Эти пределы видны на схеме конкретного матча; размеры секторов остаются приблизительными.
const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
for (const seat of seats) {
  const shortSector = seat.stand === 'north' && seat.sector === 24;
  const nineteenRows = (seat.stand === 'north' && seat.sector === 25)
    || (seat.stand === 'south' && (seat.sector === 53 || seat.sector === 54));
  if (shortSector && seat.row > 7) seat.hidden = true;
  if (nineteenRows) {
    const row = Math.round((seat.row - 1) * 18 / 33);
    if (seat.row !== 1 + Math.round(row * 33 / 18)) seat.hidden = true;
    else seat.row = row + 1;
  }
}
for (const [mesh, data] of [[yellow, yellowData], [blue, blueData], [green, greenData], [seatHits, seats]]) {
  data.forEach((seat, index) => {
    if (seat.hidden) mesh.setMatrixAt(index, hiddenMatrix);
  });
}
// Цветной план секторов для общего вида: плоские плитки над местами (одна на кресло), цвет по номеру сектора.
// Видна только на первом шаге выбора; номер и трибуна показываются при наведении, в списке секторов и на табличках.
const sectorColors = ['#e8553d', '#f0a81c', '#47b05e', '#2f8fe0', '#9b59b6', '#17a8a1', '#e86a9f', '#8a9a2b'];
const sectorColorOf = (sector) => new THREE.Color(sectorColors[sector % sectorColors.length]);
// Плитки наклонены вдоль ската трибуны (ряд поднимается на 0,37 м на 0,72 м), чтобы покрывать места и при взгляде под малым углом.
const planGeometry = new THREE.PlaneGeometry(0.47, 0.9);
planGeometry.rotateX(-Math.PI / 2);
planGeometry.rotateX(-Math.atan2(0.37, 0.72));
planGeometry.translate(0, 0.5, 0.0);
const sectorPlan = new THREE.InstancedMesh(planGeometry, new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }), seats.length);
const sectorSeatIndices = new Map();
seats.forEach((seat, index) => {
  sectorPlan.setMatrixAt(index, seat.hidden ? hiddenMatrix : seat.matrix);
  sectorPlan.setColorAt(index, sectorColorOf(seat.sector));
  if (seat.hidden) return;
  if (!sectorSeatIndices.has(seat.sector)) sectorSeatIndices.set(seat.sector, []);
  sectorSeatIndices.get(seat.sector).push(index);
});
// Поиск места под курсором без пересечения луча с 25 тысячами плиток: сетка 4 м по (x, z) и шаги по высоте вдоль луча сверху вниз.
const seatGrid = new Map();
const seatCell = (value) => Math.floor(value / 4);
seats.forEach((seat) => {
  if (seat.hidden) return;
  const key = `${seatCell(seat.position.x)}|${seatCell(seat.position.z)}`;
  if (!seatGrid.has(key)) seatGrid.set(key, []);
  seatGrid.get(key).push(seat);
});
const planPoint = new THREE.Vector3();
function pickPlanSeat(ray) {
  if (Math.abs(ray.direction.y) < 0.05) return null;
  for (let height = 14; height > 0.2; height -= 0.25) {
    const t = (height - ray.origin.y) / ray.direction.y;
    if (t < 0) continue;
    planPoint.copy(ray.direction).multiplyScalar(t).add(ray.origin);
    const cx = seatCell(planPoint.x);
    const cz = seatCell(planPoint.z);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const list = seatGrid.get(`${cx + dx}|${cz + dz}`);
        if (!list) continue;
        for (const seat of list) {
          if (Math.abs(seat.position.y + 0.5 - height) < 0.4 && Math.hypot(seat.position.x - planPoint.x, seat.position.z - planPoint.z) < 0.8) return seat;
        }
      }
    }
  }
  return null;
}
sectorPlan.visible = false;
sectorPlan.frustumCulled = false;
scene.add(sectorPlan);
// Подсветка сектора на плане (по поведению Halden Arena): выбранный сектор яркий с золотистым оттенком, остальные приглушены.
const planColors = sectorPlan.instanceColor.array;
const planBase = planColors.slice();
let hoveredSector = null;
function hoverSector(sector) {
  if (sector === hoveredSector) return;
  hoveredSector = sector;
  if (sector === null) planColors.set(planBase);
  else {
    for (let i = 0; i < planColors.length; i += 1) planColors[i] = planBase[i] * 0.38;
    const gold = [1, 0.93, 0.72];
    for (const index of sectorSeatIndices.get(sector) || []) {
      const k = index * 3;
      for (let c = 0; c < 3; c += 1) planColors[k + c] = planBase[k + c] * 0.5 + gold[c] * 0.5;
    }
  }
  sectorPlan.instanceColor.needsUpdate = true;
}
// Сброс подсветки через 260 мс после ухода курсора: на границах секторов и между плитками не мигает.
let hoverClearTimer = 0;
function planHover(sector) {
  if (sector !== null) {
    clearTimeout(hoverClearTimer);
    hoverClearTimer = 0;
    hoverSector(sector);
  } else if (!hoverClearTimer && hoveredSector !== null) {
    hoverClearTimer = setTimeout(() => { hoverClearTimer = 0; hoverSector(null); markDirty(); }, 260);
  }
}
// Таблички с номерами секторов над верхним рядом каждого сектора (положение ориентировочное).
{
  const topBySector = new Map();
  for (const seat of seats) {
    if (seat.hidden || !seat.sector) continue;
    const entry = topBySector.get(seat.sector) || { y: -Infinity, items: [] };
    if (seat.position.y > entry.y + 0.2) { entry.y = seat.position.y; entry.items = []; }
    if (seat.position.y > entry.y - 0.2) entry.items.push(seat.position);
    topBySector.set(seat.sector, entry);
  }
  // Все таблички рисуются на одном атласе: один материал вместо десятков.
  const sectorsList = [...topBySector.keys()];
  const columns = 8;
  const atlasRows = Math.ceil(sectorsList.length / columns);
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = columns * 128;
  atlasCanvas.height = atlasRows * 64;
  const atlasContext = atlasCanvas.getContext('2d');
  sectorsList.forEach((sector, index) => {
    const x = (index % columns) * 128;
    const y = Math.floor(index / columns) * 64;
    atlasContext.fillStyle = '#14181a';
    atlasContext.fillRect(x, y, 128, 64);
    atlasContext.strokeStyle = '#e0a617';
    atlasContext.lineWidth = 4;
    atlasContext.strokeRect(x + 2, y + 2, 124, 60);
    atlasContext.fillStyle = '#f4f1e2';
    atlasContext.font = '700 42px system-ui, sans-serif';
    atlasContext.textAlign = 'center';
    atlasContext.textBaseline = 'middle';
    atlasContext.fillText(String(sector), x + 64, y + 35);
  });
  const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  atlasTexture.anisotropy = 4;
  const signMaterial = new THREE.MeshBasicMaterial({ map: atlasTexture });
  sectorsList.forEach((sector, index) => {
    const entry = topBySector.get(sector);
    const center = new THREE.Vector3();
    entry.items.forEach((position) => center.add(position));
    center.divideScalar(entry.items.length);
    const outward = new THREE.Vector3(center.x, 0, center.z).normalize();
    const geometry = new THREE.PlaneGeometry(2.6, 1.3);
    const uv = geometry.attributes.uv;
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, (column + uv.getX(i)) / columns, 1 - (row + 1 - uv.getY(i)) / atlasRows);
    }
    const sign = new THREE.Mesh(geometry, signMaterial);
    sign.position.set(center.x + outward.x * 1.4, entry.y + 2.1, center.z + outward.z * 1.4);
    sign.lookAt(0, sign.position.y, 0);
    scene.add(sign);
  });
}
// Небольшой разброс яркости кресел: выгоревшие и более тёмные места.
{
  let seed = 11;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const shade = new THREE.Color();
  for (const [mesh, total] of [[yellow, yellowCount], [blue, blueCount], [green, greenCount]]) {
    for (let i = 0; i < total; i += 1) {
      const value = 0.82 + random() * 0.18;
      mesh.setColorAt(i, shade.setRGB(value, value, value));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
yellow.count = yellowCount;
blue.count = blueCount;
green.count = greenCount;
yellow.instanceMatrix.needsUpdate = true;
blue.instanceMatrix.needsUpdate = true;
green.instanceMatrix.needsUpdate = true;
seatHits.count = seats.length;
seatHits.instanceMatrix.needsUpdate = true;
aisleSteps.instanceMatrix.needsUpdate = true;
aisleSteps.receiveShadow = true;
// Меши из тысяч копий всегда видны целиком: отключаем отсечение по границам, чтобы кресла не исчезали при повороте.
for (const instanced of [yellow, blue, green, seatHits, aisleSteps]) instanced.frustumCulled = false;
scene.add(yellow, blue, green, seatHits, aisleSteps);
// Выходы на верхней кромке чаши в конце каждого прохода (положение и размеры ориентировочные).
{
  const darkOpening = new THREE.MeshStandardMaterial({ color: '#0d1112', roughness: 1 });
  for (const aisle of aisles) {
    const top = aisle[aisle.length - 1];
    const outward = new THREE.Vector3(top.x, 0, top.z).normalize();
    const base = new THREE.Vector3(top.x + outward.x * 1.5, top.y - 0.3, top.z + outward.z * 1.5);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 0.9), darkConcrete);
    const opening = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 0.95), darkOpening);
    for (const mesh of [frame, opening]) {
      mesh.position.set(base.x, base.y + 1.7, base.z);
      mesh.lookAt(0, mesh.position.y, 0);
      mesh.castShadow = mesh === frame;
      mesh.receiveShadow = true;
      scene.add(mesh);
    }
    opening.position.y = base.y + 1.4;
  }
}
// Поручни проходов: тонкие металлические трубки и стойки вместо линий.
const railGeometries = [];
const railUp = new THREE.Vector3(0, 1, 0);
function railTube(a, b, radius) {
  const direction = b.clone().sub(a);
  const tube = new THREE.CylinderGeometry(radius, radius, direction.length(), 6);
  tube.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(railUp, direction.clone().normalize()));
  const middle = a.clone().add(b).multiplyScalar(0.5);
  tube.translate(middle.x, middle.y, middle.z);
  railGeometries.push(tube);
}
for (const aisle of aisles) {
  for (let row = 0; row < aisle.length - 1; row += 1) {
    const start = aisle[row].clone();
    const end = aisle[row + 1].clone();
    railTube(start.clone().setY(start.y + 0.85), end.clone().setY(end.y + 0.85), 0.025);
    railTube(start.clone().setY(start.y + 0.45), end.clone().setY(end.y + 0.45), 0.018);
    if (row % 3 === 0) railTube(start, start.clone().setY(start.y + 0.85), 0.02);
  }
}
const rails = new THREE.Mesh(mergeGeometries(railGeometries), new THREE.MeshStandardMaterial({ color: '#c9d1d3', metalness: 0.85, roughness: 0.3 }));
rails.castShadow = true;
scene.add(rails);
// Номера рядов на ступенях у каждого прохода: один атлас и один меш (положение ориентировочное).
{
  const columns = 6;
  const cell = 64;
  const atlasRows = Math.ceil(rows / columns);
  const numberCanvas = document.createElement('canvas');
  numberCanvas.width = columns * cell;
  numberCanvas.height = atlasRows * cell;
  const numberContext = numberCanvas.getContext('2d');
  numberContext.fillStyle = '#f4f1e2';
  numberContext.font = '700 40px system-ui, sans-serif';
  numberContext.textAlign = 'center';
  numberContext.textBaseline = 'middle';
  for (let row = 0; row < rows; row += 1) {
    numberContext.fillText(String(row + 1), (row % columns) * cell + cell / 2, Math.floor(row / columns) * cell + cell / 2 + 2);
  }
  const numberTexture = new THREE.CanvasTexture(numberCanvas);
  numberTexture.colorSpace = THREE.SRGBColorSpace;
  numberTexture.anisotropy = 8;
  const labelGeometries = [];
  const labelMatrix = new THREE.Object3D();
  aisles.forEach((aisle) => {
    aisle.forEach((point, row) => {
      const inward = new THREE.Vector3(-point.x, 0, -point.z).normalize();
      const plane = new THREE.PlaneGeometry(0.3, 0.3);
      const uv = plane.attributes.uv;
      const column = row % columns;
      const line = Math.floor(row / columns);
      for (let i = 0; i < uv.count; i += 1) uv.setXY(i, (column + uv.getX(i)) / columns, 1 - (line + 1 - uv.getY(i)) / atlasRows);
      labelMatrix.position.set(point.x + inward.x * 0.2, point.y - 0.5, point.z + inward.z * 0.2);
      labelMatrix.lookAt(labelMatrix.position.x + inward.x, labelMatrix.position.y, labelMatrix.position.z + inward.z);
      labelMatrix.updateMatrix();
      plane.applyMatrix4(labelMatrix.matrix);
      labelGeometries.push(plane);
    });
  });
  const rowNumbers = new THREE.Mesh(mergeGeometries(labelGeometries), new THREE.MeshBasicMaterial({ map: numberTexture, transparent: true, alphaTest: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  rowNumbers.frustumCulled = false;
  scene.add(rowNumbers);
  labelGeometries.forEach((geometry) => geometry.dispose());
}

// Пропорции здания и навеса ориентировочные: измеренного чертежа пока нет.
modelLoader.load(asset('west-building.glb'), (model) => {
  model.scene.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  // Здание закрывает проём в верхних рядах западной трибуны: после увеличения чаши проём сместился наружу.
  model.scene.position.z = -72.5 * (bowlScaleZ - 1);
  scene.add(model.scene);
  renderer.shadowMap.needsUpdate = true;
}, undefined, (error) => console.error('Не удалось загрузить здание трибуны:', error));
let roofModel;
modelLoader.load(asset('stadium-roof.glb'), (model) => {
  model.scene.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  roofModel = model.scene;
  roofModel.visible = !sectorPlan.visible;
  scene.add(model.scene);
  renderer.shadowMap.needsUpdate = true;
}, undefined, (error) => console.error('Не удалось загрузить модель навеса:', error));
const roofLights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.75, 0.16, 0.25), new THREE.MeshStandardMaterial({ color: '#f5f2df', emissive: '#e5e0c7', emissiveIntensity: 0.45 }), 33);
for (let i = 0; i < 33; i += 1) {
  helper.position.set(-48 + i * 3, 18.3, -56.4);
  helper.rotation.set(0, 0, 0);
  helper.updateMatrix();
  roofLights.setMatrixAt(i, helper.matrix);
}
roofLights.instanceMatrix.needsUpdate = true;
scene.add(roofLights);
for (const x of [-52.5, 52.5]) {
  const direction = Math.sign(x);
  for (const z of [-3.66, 3.66]) box(0.12, 2.44, 0.12, x, 1.22, z, white);
  box(0.12, 0.12, 7.32, x, 2.44, 0, white);
  const netLines = [];
  for (let z = -3.6; z <= 3.61; z += 0.6) netLines.push(x, 2.44, z, x + direction * 2, 0, z);
  for (let y = 0.4; y <= 2; y += 0.4) {
    const backX = x + direction * (2 - y / 2.44 * 2);
    netLines.push(backX, y, -3.66, backX, y, 3.66);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(netLines, 3));
  scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#d5dfd6', transparent: true, opacity: 0.7 })));
}
const scoreboardFrame = material('#b7bcb7');
const scoreboardScreen = material('#151d1d');
for (const z of [-4.5, 4.5]) box(1, 10, 1, -99 * bowlScaleX, 5, z, scoreboardFrame);
box(1.2, 7.6, 15, -99 * bowlScaleX, 13.8, 0, scoreboardFrame);
const scoreCanvas = document.createElement('canvas');
scoreCanvas.width = 2048;
scoreCanvas.height = 960;
const scoreContext = scoreCanvas.getContext('2d');
scoreContext.scale(2, 2);
scoreContext.fillStyle = '#071014';
scoreContext.fillRect(0, 0, 1024, 480);
scoreContext.textAlign = 'center';
scoreContext.fillStyle = '#e0a617';
scoreContext.font = '700 64px system-ui, sans-serif';
scoreContext.fillText('ЦЕНТРАЛЬНЫЙ СТАДИОН', 512, 100);
scoreContext.fillStyle = '#f4f1e2';
scoreContext.font = '700 190px system-ui, sans-serif';
scoreContext.fillText('0 : 0', 512, 300);
scoreContext.fillStyle = '#4c9bff';
scoreContext.font = '600 56px system-ui, sans-serif';
scoreContext.fillText('АЛМАТЫ  ·  00:00', 512, 410);
// Сетка светодиодов: тёмные промежутки между «пикселями» табло.
scoreContext.setTransform(1, 0, 0, 1, 0, 0);
scoreContext.fillStyle = 'rgba(0, 0, 0, 0.55)';
for (let x = 0; x < 2048; x += 8) scoreContext.fillRect(x, 0, 2, 960);
for (let y = 0; y < 960; y += 8) scoreContext.fillRect(0, y, 2048, 2);
const scoreTexture = new THREE.CanvasTexture(scoreCanvas);
scoreTexture.colorSpace = THREE.SRGBColorSpace;
scoreTexture.anisotropy = 8;
const scoreLit = new THREE.MeshStandardMaterial({ map: scoreTexture, emissive: '#ffffff', emissiveMap: scoreTexture, emissiveIntensity: 1.2, roughness: 0.35 });
// Тёмная рамка вокруг экрана табло.
box(0.04, 7.2, 14.5, -99 * bowlScaleX + 0.62, 13.8, 0, scoreboardScreen);
const scoreScreen = new THREE.Mesh(new THREE.BoxGeometry(0.08, 6.4, 13.7), [scoreLit, scoreboardScreen, scoreboardScreen, scoreboardScreen, scoreboardScreen, scoreboardScreen]);
scoreScreen.position.set(-99 * bowlScaleX + 0.64, 13.8, 0);
scene.add(scoreScreen);
// Четыре мачты освещения по 40 м на восточном краю (модель из work/blender/create_floodlight_masts.py).
// Светящиеся панели ламп (вечером ярче) повторяют положение ламп модели.
const mastXs = [-84, -28, 28, 84];
const mastZ = 94;
modelLoader.load(asset('floodlight-masts.glb'), (model) => {
  model.scene.traverse((object) => { if (object.isMesh) object.castShadow = true; });
  scene.add(model.scene);
  renderer.shadowMap.needsUpdate = true;
}, undefined, (error) => console.error('Не удалось загрузить мачты:', error));
const floodlights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.62, 0.05), new THREE.MeshStandardMaterial({ color: '#ecede4', emissive: '#fff3d0', emissiveIntensity: 0.6 }), mastXs.length * 24);
let lightIndex = 0;
for (const x of mastXs) {
  for (let column = 0; column < 8; column += 1) {
    for (let row = 0; row < 3; row += 1) {
      helper.position.set(x - 2.8 + column * 0.8, 37.3 + row, mastZ - 0.2);
      helper.rotation.set(0, 0, 0);
      helper.updateMatrix();
      floodlights.setMatrixAt(lightIndex++, helper.matrix);
    }
  }
}
scene.add(floodlights);
floodlights.instanceMatrix.needsUpdate = true;
for (const z of [-50.5, 50.5]) {
  for (let x = -48; x <= 48; x += 4) box(0.06, 1.1, 0.06, x, 0.7, z, steel);
  for (const y of [0.5, 1.15]) box(96, 0.06, 0.06, 0, y, z, steel);
}
// Сетка-рабица между стойками ограждения: ромбовидный рисунок на прозрачной плоскости.
{
  const netCanvas = document.createElement('canvas');
  netCanvas.width = 64;
  netCanvas.height = 64;
  const netContext = netCanvas.getContext('2d');
  netContext.strokeStyle = '#cfd6d4';
  netContext.lineWidth = 3;
  netContext.beginPath();
  netContext.moveTo(0, 32); netContext.lineTo(32, 0); netContext.lineTo(64, 32); netContext.lineTo(32, 64); netContext.lineTo(0, 32);
  netContext.stroke();
  const netTexture = new THREE.CanvasTexture(netCanvas);
  netTexture.colorSpace = THREE.SRGBColorSpace;
  netTexture.wrapS = THREE.RepeatWrapping;
  netTexture.wrapT = THREE.RepeatWrapping;
  netTexture.repeat.set(96 / 0.12, 0.65 / 0.12);
  netTexture.anisotropy = 8;
  const netMaterial = new THREE.MeshBasicMaterial({ map: netTexture, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, depthWrite: false });
  for (const z of [-50.5, 50.5]) {
    const net = new THREE.Mesh(new THREE.PlaneGeometry(96, 0.65), netMaterial);
    net.position.set(0, 0.825, z);
    scene.add(net);
  }
}

const views = {
  overview: { label: 'Общий вид', position: [200, 170, 245] },
  west: { label: 'Западная трибуна', position: [0, 12, 30], target: [0, 8, -70 * bowlScaleZ] },
  east: { label: 'Восточная трибуна', position: [0, 27, -38], target: [0, 5, 70 * bowlScaleZ] },
  north: { label: 'Северная трибуна', position: [-38, 27, 0], target: [82 * bowlScaleX, 5, 0] },
  south: { label: 'Южная трибуна', position: [38, 27, 0], target: [-82 * bowlScaleX, 5, 0] },
};
let view = 'overview';
let stage = 'stand';
let bookingOpen = false;
let selectedSeat;
let pointerStartX = 0;
let pointerStartY = 0;
let yaw = 0;
let pitch = 0;
let initialYaw = 0;
let dragging = false;
let lastX = 0;
let lastY = 0;
let cameraTransition;
let firstView = true;
function moveCamera(position, target, fov, orbit, instant = false, time = 1100) {
  const destination = camera.clone();
  destination.position.copy(position);
  destination.lookAt(target);
  controls.enabled = false;
  if (orbit) controls.target.copy(target);
  const duration = instant || firstView || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : time;
  firstView = false;
  cameraTransition = {
    start: performance.now(), duration, orbit,
    fromPosition: camera.position.clone(), toPosition: position.clone(),
    fromRotation: camera.quaternion.clone(), toRotation: destination.quaternion.clone(),
    fromFov: camera.fov, toFov: fov,
  };
}
function updateCameraFraming() {
  if (bookingOpen && window.innerWidth <= 700) {
    camera.setViewOffset(window.innerWidth, window.innerHeight, 0, Math.round(window.innerHeight * (view === 'seat' ? 0.16 : 0.22)), window.innerWidth, window.innerHeight);
  } else if (bookingOpen) {
    camera.setViewOffset(window.innerWidth, window.innerHeight, 180, 0, window.innerWidth, window.innerHeight);
  } else {
    camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
}
function lookFromSeat() {
  const direction = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
  camera.lookAt(camera.position.clone().add(direction));
}
// Цветной план секторов виден только на общем виде в начале выбора.
function updatePlan() {
  sectorPlan.visible = bookingOpen && view === 'overview' && stage === 'stand';
  if (!sectorPlan.visible) hoverSector(null);
  // Крыша убирается, чтобы под ней были видны сектора западной трибуны.
  if (roofModel) roofModel.visible = !sectorPlan.visible;
  roofLights.visible = !sectorPlan.visible;
  renderer.shadowMap.needsUpdate = true;
}
function setView(name) {
  view = name;
  stage = 'stand';
  updatePlan();
  applyDetail('none');
  clearMarker();
  const selected = views[name];
  const target = name === 'overview' ? new THREE.Vector3(0, 4, 0) : new THREE.Vector3(...selected.target);
  const phone = window.innerWidth <= 700;
  // «Выбрать место»: камера плавно поднимается и смотрит на стадион почти строго сверху, чтобы были видны все сектора.
  if (name === 'overview' && bookingOpen) moveCamera(new THREE.Vector3(0, phone ? 380 : 375, 50), target, phone ? 66 : 38, true, false, 1700);
  else if (name === 'overview' && phone) moveCamera(new THREE.Vector3(...selected.position).multiplyScalar(0.86), target, 62, true);   // на телефоне стадион крупнее: он должен занимать почти всю ширину экрана
  else moveCamera(new THREE.Vector3(...selected.position), target, name === 'overview' ? 38 : 50, name === 'overview');
  updateCameraFraming();
  updateSeatHighlights();
  document.querySelector('#app').classList.toggle('seat-mode', name !== 'overview');
  document.querySelector('#current-view').textContent = selected.label;
  document.querySelector('#hint').textContent = name === 'overview' ? (bookingOpen ? 'Нажмите на сектор' : 'Выберите трибуну') : 'Нажмите на сектор';
  document.querySelectorAll('.view-button').forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (bookingOpen) renderStage();
  updateHash();
}
const standSelect = document.querySelector('#stand-select');
const sectorSelect = document.querySelector('#sector-select');
const rowSelect = document.querySelector('#row-select');
const seatSelect = document.querySelector('#seat-select');
const standNames = { west: 'Западная трибуна', east: 'Восточная трибуна', north: 'Северная трибуна', south: 'Южная трибуна' };

function updateSeatHighlights() {
  const selected = new THREE.Color('#ffffff');
  const muted = new THREE.Color('#aaaaaa');
  for (const [mesh, data] of [[yellow, yellowData], [blue, blueData], [green, greenData]]) {
    data.forEach((seat, index) => {
      const active = !bookingOpen || view === 'seat' || view === 'overview' || seat.stand === standSelect.value;
      mesh.setColorAt(index, active ? selected : muted);
    });
    mesh.instanceColor.needsUpdate = true;
  }
}
function updateSelectedSeat() {
  selectedSeat = seats.find((seat) => !seat.hidden && seat.stand === standSelect.value && seat.sector === Number(sectorSelect.value) && seat.row === Number(rowSelect.value) && seat.number === Number(seatSelect.value));
}
function updateRowOptions(row = Number(rowSelect.value) || 1) {
  const availableRows = [...new Set(seats.filter((seat) => !seat.hidden && seat.stand === standSelect.value && seat.sector === Number(sectorSelect.value)).map((seat) => seat.row))];
  rowSelect.replaceChildren(...availableRows.map((number) => new Option(String(number), String(number))));
  rowSelect.value = String(row);
  if (!rowSelect.value) rowSelect.value = String(availableRows[0]);
}
function updateSeatOptions(number = 1) {
  const choices = seats.filter((seat) => !seat.hidden && seat.stand === standSelect.value && seat.sector === Number(sectorSelect.value) && seat.row === Number(rowSelect.value));
  seatSelect.replaceChildren(...choices.map((seat) => new Option(String(seat.number), String(seat.number))));
  seatSelect.value = String(number);
  if (!seatSelect.value && choices.length) seatSelect.value = String(choices[0].number);
  updateSelectedSeat();
}
function updateSectorOptions(sector = standSectors[standSelect.value][0]) {
  sectorSelect.replaceChildren(...standSectors[standSelect.value].map((number) => new Option(String(number), String(number))));
  sectorSelect.value = String(sector);
  updateRowOptions();
  updateSeatOptions();
  updateSeatHighlights();
}
function chooseSeat(seat) {
  standSelect.value = seat.stand;
  updateSectorOptions(seat.sector);
  rowSelect.value = String(seat.row);
  updateSeatOptions(seat.number);
}
const seatMarker = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 1.0), new THREE.MeshBasicMaterial({ color: '#ff8a00', transparent: true, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
const markerBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6, 8), new THREE.MeshBasicMaterial({ color: '#ffd24a' }));
markerBeam.position.y = 3.6;
seatMarker.add(markerBeam);
seatMarker.visible = false;
seatMarker.renderOrder = 5;
scene.add(seatMarker);
const markerPosition = new THREE.Vector3();
const markerScale = new THREE.Vector3();
function showMarker(seat) {
  seat.matrix.decompose(markerPosition, seatMarker.quaternion, markerScale);
  seatMarker.position.copy(markerPosition).add(new THREE.Vector3(0, 0.38, 0));
  seatMarker.visible = true;
}
function clearMarker() {
  seatMarker.visible = false;
}
// Режимы показа мест: none (общий вид, простые кресла), sector (только места сектора, детально), near (вид с места: рядом детально).
// Подсветка ряда под курсором в секторе (по поведению Halden Arena): ряд ярче, остальные приглушены примерно до 55%.
const rowBase = new THREE.Color(1, 1, 1);
const rowBright = new THREE.Color(1.3, 1.22, 1.0);
const rowDim = new THREE.Color(0.55, 0.55, 0.55);
let hoveredRow = null;
function hoverRow(seat) {
  const row = seat ? seat.row : null;
  if (row === hoveredRow) return;
  hoveredRow = row;
  for (const placed of sectorRefs) detailMeshes[placed.group].setColorAt(placed.detailIndex, row === null ? rowBase : placed.row === row ? rowBright : rowDim);
  for (const mesh of Object.values(detailMeshes)) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
function applyDetail(mode, origin) {
  const picked = [];
  if (mode === 'sector') {
    const sector = Number(sectorSelect.value);
    for (const seat of seats) if (!seat.hidden && seat.stand === standSelect.value && seat.sector === sector) picked.push(seat);
  } else if (mode === 'near') {
    for (const seat of seats) if (!seat.hidden && seat.position.distanceToSquared(origin) < detailRadius * detailRadius) picked.push(seat);
    // Ближние места первыми: если лимит исчерпан, детальными остаются самые близкие к камере.
    picked.sort((a, b) => a.position.distanceToSquared(origin) - b.position.distanceToSquared(origin));
  }
  // В детальные меши попадают только реально помещённые места; остальные остаются простыми, чтобы не было «дыр».
  const placed = new Set();
  const counts = { yellow: 0, blue: 0, green: 0 };
  const midCounts = { yellow: 0, blue: 0, green: 0 };
  const nearSquared = nearDetailRadius * nearDetailRadius;
  let legs = 0;
  sectorRefs.length = 0;
  for (const seat of picked) {
    if (mode === 'near' && seat.position.distanceToSquared(origin) >= nearSquared) {
      // Среднее расстояние: упрощённая модель кресла.
      if (midCounts[seat.group] >= detailCapacity) continue;
      detailMid[seat.group].setMatrixAt(midCounts[seat.group]++, seat.matrix);
      detailLegs.setMatrixAt(legs++, seat.matrix);
      placed.add(seat);
      continue;
    }
    if (counts[seat.group] >= detailCapacity) continue;
    seat.detailIndex = counts[seat.group];
    detailMeshes[seat.group].setMatrixAt(counts[seat.group]++, seat.matrix);
    detailLegs.setMatrixAt(legs++, seat.matrix);
    sectorHits.setMatrixAt(sectorRefs.length, seat.matrix);
    sectorRefs.push(seat);
    placed.add(seat);
  }
  const mainVisible = mode !== 'sector';
  for (const [mesh, data] of [[yellow, yellowData], [blue, blueData], [green, greenData]]) {
    mesh.visible = mainVisible;
    if (!mainVisible) continue;
    data.forEach((seat, index) => mesh.setMatrixAt(index, !seat.hidden && !placed.has(seat) ? seat.matrix : hiddenMatrix));
    mesh.instanceMatrix.needsUpdate = true;
  }
  for (const [group, mesh] of Object.entries(detailMeshes)) {
    mesh.count = counts[group];
    mesh.instanceMatrix.needsUpdate = true;
  }
  for (const [group, mesh] of Object.entries(detailMid)) {
    mesh.count = midCounts[group];
    mesh.instanceMatrix.needsUpdate = true;
  }
  detailLegs.count = legs;
  detailLegs.instanceMatrix.needsUpdate = true;
  hoveredRow = undefined;
  hoverRow(null);
  sectorHits.count = sectorRefs.length;
  sectorHits.instanceMatrix.needsUpdate = true;
  if (sectorRefs.length) sectorHits.computeBoundingSphere();
}
function currentPlace() {
  return `${standNames[selectedSeat.stand]} · сектор ${selectedSeat.sector} · ряд ${selectedSeat.row} · место ${selectedSeat.number}`;
}
const stepIndex = { stand: 1, sector: 2, confirm: 2, seat: 3 };
function renderStage() {
  const current = stepIndex[stage] ?? 1;
  document.querySelectorAll('#steps li').forEach((item, index) => {
    item.classList.toggle('done', index < current);
    item.classList.toggle('current', index === current);
  });
  const sector = Number(sectorSelect.value);
  const plan = view === 'overview' && stage === 'stand';
  document.querySelector('#panel-title').textContent = stage === 'seat' ? 'Вид с места'
    : plan ? 'Выберите сектор'
    : stage === 'stand' ? standNames[standSelect.value]
    : `${standNames[standSelect.value]} · сектор ${sector}`;
  document.querySelector('#stand-copy').textContent = plan
    ? 'Сектора отмечены цветами. Нажмите на сектор на стадионе или выберите его в списке.'
    : 'Выберите сектор в списке или нажмите на него на трибуне.';
  document.querySelector('#stage-stand').hidden = stage !== 'stand';
  document.querySelector('#stage-sector').hidden = stage !== 'sector';
  document.querySelector('#stage-confirm').hidden = stage !== 'confirm';
  document.querySelector('#sector-copy').textContent = `Нажмите на место в секторе ${sector}. Остальные сектора скрыты.`;
  if (stage === 'confirm' && selectedSeat) document.querySelector('#confirm-place').textContent = currentPlace();
  const chips = document.querySelector('#sector-chips');
  const makeChip = (number, stand) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = String(number);
    chip.setAttribute('aria-label', `${standNames[stand]}, сектор ${number}`);
    if (plan) chip.style.borderBottom = `4px solid ${sectorColors[number % sectorColors.length]}`;
    chip.addEventListener('click', () => pickSector(stand, number));
    chip.addEventListener('pointerenter', () => { if (plan) planHover(number); });
    chip.addEventListener('pointerleave', () => { if (plan) planHover(null); });
    return chip;
  };
  if (plan) {
    chips.replaceChildren(...Object.entries(standSectors).flatMap(([stand, numbers]) => {
      const title = document.createElement('p');
      title.className = 'chip-group';
      title.textContent = standNames[stand];
      return [title, ...numbers.map((number) => makeChip(number, stand))];
    }));
  } else {
    chips.replaceChildren(...standSectors[standSelect.value].map((number) => makeChip(number, standSelect.value)));
  }
  document.querySelector('#hint').textContent = { stand: 'Нажмите на сектор', sector: 'Нажмите на место', confirm: 'Подтвердите место в панели', seat: 'Перетащите, чтобы осмотреться' }[stage] || '';
}
// Выбор сектора с общего плана или из списка: открывает его трибуну и переходит к выбору места.
function pickSector(stand, sector) {
  openBooking(stand);
  selectSector(sector);
}
function selectSector(sector) {
  if (view === 'overview') setView(standSelect.value);
  updateSectorOptions(sector);
  stage = 'sector';
  updatePlan();
  clearMarker();
  applyDetail('sector');
  showSector();
  renderStage();
  preloadPanoramas(standSelect.value, Number(sectorSelect.value));
}
function showSector() {
  const group = seats.filter((seat) => !seat.hidden && seat.stand === standSelect.value && seat.sector === Number(sectorSelect.value));
  if (!group.length) return;
  const center = new THREE.Vector3();
  group.forEach((seat) => center.add(seat.position));
  center.multiplyScalar(1 / group.length);
  let radius = 0;
  group.forEach((seat) => { radius = Math.max(radius, seat.position.distanceTo(center)); });
  const fov = 46;
  const towardsField = new THREE.Vector3(-center.x, 0, -center.z).normalize();
  const distance = Math.max(radius / Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 1.45, 24);
  const position = center.clone().addScaledVector(towardsField, distance);
  position.y = center.y + Math.min(radius * 0.4, 14);
  moveCamera(position, center, fov, false);
}
// Предрендеренные панорамы для вида с места (Blender Cycles). Если для кресла есть ближайший узел, показывается он: фотореалистично и дёшево для телефона.
const panoScene = new THREE.Scene();
let panoMode = false;
let panoYawLimit = 0.6;
let panoPitchLimit = 0.35;
let panoNodes = null;
const panoTextures = new Map();
let panoSphere;
let panoNodeList = null;
function loadPanoNodes() {
  if (!usePanoramas) return Promise.resolve([]);
  if (!panoNodes) {
    panoNodes = fetch(asset('panoramas/index.json')).then((response) => (response.ok ? response.json() : Promise.reject(new Error('index')))).then((list) => { panoNodeList = list; return list; }).catch(() => { panoNodes = null; return []; });
  }
  return panoNodes;
}
function chooseNode(nodes, position) {
  const seat = selectedSeat;
  // Узел берётся из того же сектора (ближайший по расстоянию); для узлов без привязки к сектору действует радиус.
  return nodes.map((item) => ({ item, distance: Math.hypot(item.position[0] - position.x, item.position[1] - position.y, item.position[2] - position.z) }))
    .filter((entry) => (entry.item.sector ? entry.item.stand === seat?.stand && entry.item.sector === seat?.sector : entry.distance < (entry.item.radius ?? 3)))
    .sort((a, b) => a.distance - b.distance)[0]?.item;
}
// Применяет панораму: сфера с картинкой, пределы поворота, стартовый взгляд. Возвращает true, если панорама показана.
function applyPanorama(node, texture, position) {
  const lon = THREE.MathUtils.degToRad(node.lon);
  const up = THREE.MathUtils.degToRad(node.latUp);
  const down = THREE.MathUtils.degToRad(node.latDown);
  if (panoSphere) { panoScene.remove(panoSphere); panoSphere.geometry.dispose(); panoSphere.material.dispose(); }
  const geometry = new THREE.SphereGeometry(100, 96, 48, 0, lon * 2, Math.PI / 2 - up, up + down);
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, toneMapped: false });
  panoSphere = new THREE.Mesh(geometry, material);
  panoSphere.position.set(position.x, position.y, position.z);
  // Картинка привязана к направлению узла на поле (центр изображения смотрит туда); взгляд по умолчанию тоже туда.
  const nodeYaw = node.yaw ?? initialYaw;
  panoSphere.rotation.y = Math.PI - lon - nodeYaw;
  initialYaw = nodeYaw;
  yaw = nodeYaw;
  panoScene.add(panoSphere);
  const fov = seatFov();
  const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * Math.min(camera.aspect, 2.2));
  panoYawLimit = Math.max(0.05, lon - halfH - 0.03);
  panoPitchLimit = Math.max(0.03, Math.min(up, down) - THREE.MathUtils.degToRad(fov / 2) - 0.02);
  panoMode = true;
  yaw = THREE.MathUtils.clamp(yaw, initialYaw - panoYawLimit, initialYaw + panoYawLimit);
  // Стартовый взгляд чуть выше горизонта: видно поле, а не кресла под ногами.
  pitch = THREE.MathUtils.clamp(0.04, -panoPitchLimit, panoPitchLimit);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  // Камера уже в точке места, перелёт по живой сцене отменяется: иначе он продолжит тянуть взгляд к старому направлению.
  cameraTransition = null;
  controls.enabled = false;
  camera.position.copy(position);
  lookFromSeat();
  markDirty();
}
// Мягкий вход: короткое затемнение скрывает подмену живой сцены на панораму.
const veil = document.querySelector('#veil');
function withVeil(action) {
  if (!veil || matchMedia('(prefers-reduced-motion: reduce)').matches) { action(); return; }
  veil.classList.add('on');
  markDirty();
  setTimeout(() => { action(); markDirty(); veil.classList.remove('on'); }, 110);
}
// Асинхронный путь: панорама ещё не загружена (или узлы не получены) — показываем живую сцену и подменяем, когда картинка готова.
async function tryPanorama(position, token) {
  const nodes = await loadPanoNodes();
  const node = chooseNode(nodes, position);
  if (!node || token !== panoToken) return;
  const texture = await getPanoTexture(node.file);
  if (!texture || token !== panoToken || view !== 'seat') return;
  withVeil(() => {
    if (token !== panoToken || view !== 'seat') return;
    renderer.initTexture(texture);
    applyPanorama(node, texture, position);
  });
}
let panoToken = 0;
// Номер версии набора панорам: меняйте при перерендере, чтобы кэш на устройствах обновился.
const PANO_VERSION = 2;
// На узком (портретном) экране угол обзора шире, чтобы в кадр попадало поле, а не только ряд кресел.
const seatFov = () => (camera.aspect < 0.8 ? 80 : 64);
const panoCacheLimit = lowPower ? 2 : 4;
// Загружает и сразу выгружает на видеокарту панораму; в кэше держим ограниченное число (память).
async function getPanoTexture(file) {
  let texture = panoTextures.get(file);
  if (texture) return texture;
  texture = await new THREE.TextureLoader().loadAsync(asset(`panoramas/${file}?v=${PANO_VERSION}`)).catch(() => null);
  if (!texture) return null;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  panoTextures.set(file, texture);
  while (panoTextures.size > panoCacheLimit) {
    const [oldest, oldTexture] = panoTextures.entries().next().value;
    panoTextures.delete(oldest);
    if (oldTexture !== texture) oldTexture.dispose();
  }
  return texture;
}
// Предзагрузка панорам выбранного сектора, чтобы «Да, посмотреть с места» открывало картинку мгновенно.
async function preloadPanoramas(stand, sector) {
  if (!usePanoramas) return;
  const nodes = (await loadPanoNodes()).filter((node) => node.stand === stand && node.sector === sector).slice(0, panoCacheLimit);
  for (const node of nodes) await getPanoTexture(node.file);
}
function showSeat() {
  if (!selectedSeat) return;
  view = 'seat';
  stage = 'seat';
  updatePlan();
  clearMarker();
  updateSeatHighlights();
  const position = selectedSeat.position.clone().add(new THREE.Vector3(0, 1, 0));
  panoMode = false;
  panoToken += 1;
  yaw = Math.atan2(-position.z, -position.x);
  initialYaw = yaw;
  pitch = -0.12;
  // Если панорама уже в кэше, переходим сразу (без пролёта по живой сцене), под коротким затемнением.
  const cachedNode = usePanoramas && panoNodeList ? chooseNode(panoNodeList, position) : null;
  const cachedTexture = cachedNode && panoTextures.get(cachedNode.file);
  // Живая сцена в виде с панорамой не рисуется, поэтому детальные кресла вокруг места собираем только когда панорамы нет.
  if (!cachedTexture) applyDetail('near', position);
  if (cachedNode && cachedTexture) {
    const token = panoToken;
    withVeil(() => {
      if (token !== panoToken || view !== 'seat') return;
      renderer.initTexture(cachedTexture);
      applyPanorama(cachedNode, cachedTexture, position);
      const look = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
      moveCamera(position, position.clone().add(look), seatFov(), false, true);
    });
  } else {
    if (usePanoramas) tryPanorama(position, panoToken);
    const direction = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
    moveCamera(position, position.clone().add(direction), seatFov(), false);
  }
  updateCameraFraming();
  document.querySelector('#preview-place').textContent = currentPlace();
  showBookingStep('preview');
  renderStage();
  updateHash();
}
function showBookingStep(step) {
  document.querySelector('#seat-form').hidden = step !== 'seat';
  document.querySelector('#seat-preview').hidden = step !== 'preview';
  document.querySelector('#app').classList.toggle('preview-open', step === 'preview');
  document.querySelector('#checkout').hidden = step !== 'checkout';
  document.querySelector('#booking-complete').hidden = step !== 'complete';
  if (step === 'seat') renderStage();
  if (step === 'preview') document.querySelector('#panel-title').textContent = 'Вид с места';
}
standSelect.addEventListener('change', () => {
  updateSectorOptions();
  setView(standSelect.value);
});
sectorSelect.addEventListener('change', () => {
  if (view === 'seat') {
    updateRowOptions();
    updateSeatOptions();
    updateSeatHighlights();
    showSeat();
  } else selectSector(Number(sectorSelect.value));
});
function pickFromSelects() {
  updateSelectedSeat();
  if (view === 'seat') showSeat();
  else if (selectedSeat && (stage === 'sector' || stage === 'confirm')) {
    stage = 'confirm';
    showMarker(selectedSeat);
    renderStage();
  }
}
rowSelect.addEventListener('change', () => {
  updateSeatOptions();
  pickFromSelects();
});
seatSelect.addEventListener('change', pickFromSelects);
function openBooking(stand) {
  bookingOpen = true;
  document.querySelector('#app').classList.add('booking-open');
  document.querySelector('#booking-panel').hidden = false;
  showBookingStep('seat');
  if (stand) standSelect.value = stand;
  updateSectorOptions();
  setView(stand ? standSelect.value : 'overview');
}
document.querySelectorAll('.view-button').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.view === 'overview') setView('overview');
  else openBooking(button.dataset.view);
}));
// «Выбрать место» открывает общий план с цветными секторами, а не случайную трибуну.
document.querySelector('#open-booking').addEventListener('click', () => openBooking());
document.querySelector('#close-booking').addEventListener('click', () => {
  bookingOpen = false;
  document.querySelector('#app').classList.remove('booking-open');
  document.querySelector('#booking-panel').hidden = true;
  setView('overview');
});
document.querySelector('#stand-view').addEventListener('click', () => setView('overview'));
document.querySelector('#seat-view').addEventListener('click', showSeat);
document.querySelector('#seat-change').addEventListener('click', () => {
  stage = 'sector';
  clearMarker();
  renderStage();
  showSector();
});
function continueBooking() {
  if (!selectedSeat) return;
  document.querySelector('#seat-summary').textContent = currentPlace();
  showBookingStep('checkout');
}
document.querySelector('#preview-continue').addEventListener('click', continueBooking);
document.querySelector('#preview-back').addEventListener('click', () => {
  showBookingStep('seat');
  setView(standSelect.value);
  selectSector(Number(sectorSelect.value));
});
document.querySelector('#back-booking').addEventListener('click', () => showBookingStep(view === 'seat' ? 'preview' : 'seat'));
document.querySelector('#confirm-booking').addEventListener('click', () => showBookingStep('complete'));
document.querySelector('#restart-booking').addEventListener('click', () => {
  showBookingStep('seat');
  setView(standSelect.value);
});
standSelect.value = 'west';
updateSectorOptions();
canvas.addEventListener('pointerdown', (event) => {
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  if (view !== 'seat' || cameraTransition) return;
  dragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging || view !== 'seat') return;
  yaw -= (event.clientX - lastX) * 0.004;
  // Живая камера: 180° (по 90° влево и вправо от направления на поле); у панорам предел задаётся её шириной.
  const yawLimit = panoMode ? panoYawLimit : Math.PI / 2;
  const pitchLimit = panoMode ? panoPitchLimit : 0.35;
  yaw = THREE.MathUtils.clamp(yaw, initialYaw - yawLimit, initialYaw + yawLimit);
  pitch = THREE.MathUtils.clamp(pitch + (event.clientY - lastY) * 0.004, -pitchLimit, pitchLimit);
  lastX = event.clientX;
  lastY = event.clientY;
  lookFromSeat();
});
canvas.addEventListener('pointerup', (event) => {
  dragging = false;
  if (cameraTransition || view === 'seat' || Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) > 5) return;
  const bounds = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  if (view === 'overview') {
    // Сначала цветная плитка сектора; если попали между плитками (проход, граница, ступень), берём ближайшее кресло к точке попадания.
    let seat = null;
    seat = pickPlanSeat(raycaster.ray);
    if (!seat || seat.hidden) {
      const hit = raycaster.intersectObjects(standLevels)[0];
      if (!hit) return;
      let best = Infinity;
      seat = null;
      for (const candidate of seats) {
        if (candidate.hidden) continue;
        const distance = candidate.position.distanceToSquared(hit.point);
        if (distance < best) { best = distance; seat = candidate; }
      }
      if (!seat || best > 36) return;
    }
    // На сенсорном экране первое касание подсвечивает сектор и показывает подпись, второе открывает его.
    if (event.pointerType === 'touch' && bookingOpen && hoveredSector !== seat.sector) {
      planHover(seat.sector);
      seatTip.textContent = `${standNames[seat.stand]} · сектор ${seat.sector} · ${(sectorSeatIndices.get(seat.sector) || []).length} мест`;
      seatTip.style.left = `${Math.min(window.innerWidth - 150, Math.max(10, event.clientX - 70))}px`;
      seatTip.style.top = `${Math.max(70, event.clientY - 54)}px`;
      seatTip.hidden = false;
      return;
    }
    seatTip.hidden = true;
    pickSector(seat.stand, seat.sector);
    return;
  }
  if (!bookingOpen) return;
  const standStage = stage === 'stand';
  const hit = raycaster.intersectObject(standStage ? seatHits : sectorHits)[0];
  if (!hit) return;
  const seat = standStage ? seats[hit.instanceId] : sectorRefs[hit.instanceId];
  if (!seat) return;
  if (seat.hidden || seat.stand !== standSelect.value) return;
  if (stage === 'stand') {
    selectSector(seat.sector);
    return;
  }
  chooseSeat(seat);
  stage = 'confirm';
  showMarker(seat);
  renderStage();

});
// Подсказка при наведении на место в режиме сектора: ряд и номер, курсор-«рука».
const seatTip = document.createElement('div');
seatTip.className = 'seat-tip';
seatTip.hidden = true;
document.querySelector('#app').appendChild(seatTip);
const hoverRaycaster = new THREE.Raycaster();
const hoverPointer = new THREE.Vector2();
let hoverFrame = 0;
canvas.addEventListener('pointermove', (event) => {
  const plan = sectorPlan.visible;
  if (dragging || cameraTransition || !bookingOpen || view === 'seat' || (stage === 'stand' && !plan) || event.pointerType === 'touch') {
    if (!seatTip.hidden) { seatTip.hidden = true; canvas.style.cursor = ''; }
    planHover(null);
    hoverRow(null);
    return;
  }
  const now = performance.now();
  if (now - hoverFrame < (plan ? 60 : 40)) return;
  hoverFrame = now;
  const bounds = canvas.getBoundingClientRect();
  hoverPointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  hoverRaycaster.setFromCamera(hoverPointer, camera);
  let seat;
  if (plan) seat = pickPlanSeat(hoverRaycaster.ray);
  else {
    const hit = hoverRaycaster.intersectObject(sectorHits)[0];
    seat = hit && sectorRefs[hit.instanceId];
  }
  if (!seat || seat.hidden) {
    seatTip.hidden = true;
    canvas.style.cursor = '';
    if (plan) { planHover(null); markDirty(); } else hoverRow(null);
    return;
  }
  if (plan) { planHover(seat.sector); markDirty(); } else { hoverRow(seat); markDirty(); }
  seatTip.textContent = plan ? `${standNames[seat.stand]} · сектор ${seat.sector} · ${(sectorSeatIndices.get(seat.sector) || []).length} мест` : `Ряд ${seat.row} · место ${seat.number}`;
  seatTip.style.left = `${event.clientX + 14}px`;
  seatTip.style.top = `${event.clientY + 14}px`;
  seatTip.hidden = false;
  canvas.style.cursor = 'pointer';
});
canvas.addEventListener('pointerleave', () => { seatTip.hidden = true; });
canvas.addEventListener('pointercancel', () => { dragging = false; });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  updateCameraFraming();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer?.setSize(window.innerWidth, window.innerHeight);
});
// Объединение неподвижных мелких объектов с одним материалом: меньше вызовов отрисовки (особенно важно для телефонов).
function mergeStatic() {
  const keep = new Set([...cornerFlags, seatMarker]);
  const standSet = new Set(standLevels);
  const groups = new Map();
  scene.updateMatrixWorld(true);
  for (const child of [...scene.children]) {
    if (!child.isMesh || child.isInstancedMesh || keep.has(child) || Array.isArray(child.material) || !child.visible) continue;
    const attributes = Object.keys(child.geometry.attributes).sort().join(',');
    const key = `${standSet.has(child) ? 'stand|' : ''}${child.material.uuid}|${child.castShadow}|${child.receiveShadow}|${child.renderOrder}|${child.geometry.index ? 'i' : 'n'}|${attributes}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(child);
  }
  standLevels.length = 0;
  for (const [key, list] of groups) {
    if (list.length < 2) {
      if (key.startsWith('stand|')) standLevels.push(...list);
      continue;
    }
    const geometries = list.map((mesh) => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
    const merged = mergeGeometries(geometries);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) {
      if (key.startsWith('stand|')) standLevels.push(...list);
      continue;
    }
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    mesh.renderOrder = list[0].renderOrder;
    for (const original of list) {
      scene.remove(original);
      original.geometry.dispose();
    }
    scene.add(mesh);
    if (key.startsWith('stand|')) standLevels.push(mesh);
  }
}
mergeStatic();

setView('overview');
if (!initialHash && !matchMedia('(prefers-reduced-motion: reduce)').matches && !navigator.connection?.saveData) {
  let showIntro = true;
  const stopIntro = () => {
    showIntro = false;
    introVideo.classList.remove('visible');
    introVideo.pause();
  };
  document.addEventListener('pointerdown', stopIntro, { once: true, capture: true });
  document.addEventListener('keydown', stopIntro, { once: true, capture: true });
  window.addEventListener('hashchange', stopIntro, { once: true });
  const size = lowPower || window.innerWidth <= 700 ? 'mobile' : 'desktop';
  const format = introVideo.canPlayType('video/webm; codecs="vp9"') ? 'webm' : 'mp4';
  introVideo.src = asset(`stadium-orbit-${size}.${format}`);
  introVideo.play().then(() => {
    if (showIntro) introVideo.classList.add('visible');
    else introVideo.pause();
  }).catch(() => {
    introVideo.hidden = true;
  });
}
// Затенение в контактах (ambient occlusion): тёмные стыки между рядами, креслами и ступенями.
// Включается только на десктопе; ?fx=0 в адресе отключает эффект.
if (location.search.includes('debug')) {
  window.__debug = { renderer, scene, camera, seats, getComposer: () => composer, getAoCamera: () => aoCamera };
  // Экспорт сцены в GLB для рендера панорам в Blender (работает только с dev-сервером).
  // Список мест (трибуна, сектор, ряд, номер, положение камеры) для планирования сетки панорам.
  window.__debug.exportSeats = async () => {
    const list = seats.filter((seat) => !seat.hidden && seat.sector).map((seat) => [seat.stand, seat.sector, seat.row, seat.number, +seat.position.x.toFixed(2), +(seat.position.y + 1).toFixed(2), +seat.position.z.toFixed(2)]);
    const response = await fetch('/__save?name=seats.json', { method: 'POST', body: JSON.stringify(list) });
    return { seats: list.length, bytes: Number(await response.text()) };
  };
  window.__debug.exportScene = async (name = 'stadium-scene.glb') => {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    // Для рендера все кресла берутся детальными (с опорами), а не упрощёнными; при любой ошибке сцена возвращается как была.
    const lowGeometry = yellow.geometry;
    const hidden = [];
    let exportLegs;
    try {
      for (const mesh of [yellow, blue, green]) mesh.geometry = detailSeatGeometry;
      exportLegs = new THREE.InstancedMesh(supportGeometry, detailLegs.material, seats.length);
      seats.forEach((seat, index) => exportLegs.setMatrixAt(index, seat.hidden ? hiddenMatrix : seat.matrix));
      scene.add(exportLegs);
      scene.traverse((object) => {
        if (object.isMesh && (object === sectorHits || object === seatHits)) { hidden.push([object, object.visible]); object.visible = false; }
      });
      const result = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true, maxTextureSize: 1024 });
      const response = await fetch(`/__save?name=${name}`, { method: 'POST', body: result });
      return Number(await response.text());
    } finally {
      hidden.forEach(([object, visible]) => { object.visible = visible; });
      for (const mesh of [yellow, blue, green]) mesh.geometry = lowGeometry;
      if (exportLegs) scene.remove(exportLegs);
    }
  };
}
// Эффект затенения в контактах: только на компьютерах и только в близких видах (сектор, место); ?fx=0 отключает.
let composer;
let aoCamera;
let bloomPass;
let eveningMode = false;
if (!lowPower && new URLSearchParams(location.search).get('fx') !== '0') {
  // Модули постобработки подгружаются отдельно и только на компьютерах: телефонам они не нужны.
  Promise.all([
    import('three/addons/postprocessing/EffectComposer.js'),
    import('three/addons/postprocessing/RenderPass.js'),
    import('three/addons/postprocessing/GTAOPass.js'),
    import('three/addons/postprocessing/OutputPass.js'),
    import('three/addons/postprocessing/UnrealBloomPass.js'),
  ]).then(([{ EffectComposer }, { RenderPass }, { GTAOPass }, { OutputPass }, { UnrealBloomPass }]) => {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const instance = new EffectComposer(renderer, target);
    instance.addPass(new RenderPass(scene, camera));
    // Далёкий рельеф (слой 1) не участвует в расчёте затенения: на огромной дальности он давал чёрные пятна.
    aoCamera = new THREE.PerspectiveCamera();
    const ao = new GTAOPass(scene, aoCamera, window.innerWidth, window.innerHeight);
    ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: qualityMax ? 16 : 12 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
    ao.enabled = qualityMax;
    instance.addPass(ao);
    // Свечение ламп, светодиодных лент и табло: только вечером и только на компьютерах.
    bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.45, 0.95);
    bloomPass.enabled = eveningMode;
    instance.addPass(bloomPass);
    instance.addPass(new OutputPass());
    instance.setPixelRatio(pixelRatio);
    instance.setSize(window.innerWidth, window.innerHeight);
    composer = instance;
  }).catch((error) => console.warn('Затенение недоступно:', error));
}

// Рендер по требованию: пока ничего не меняется, сцена не перерисовывается (экономит батарею и нагрев).
const maxPixelRatio = pixelRatio;
const minPixelRatio = lowPower ? 0.85 : midTier ? 0.9 : qualityMax ? maxPixelRatio : 1.0;
let pixelCeiling = maxPixelRatio;
let lastViewCap = maxPixelRatio;
let lastActivity = performance.now() + 8000;
let lastRender = 0;
let frameTotal = 0;
let frameCount = 0;
let lastResolutionChange = 0;
let pendingPixelRatio = null;
let aoStrikes = 0;
let aoPausedUntil = 0;
let aoPauses = 0;
let lastRaise = 0;
let noRaiseUntil = 0;
const markDirty = () => { lastActivity = performance.now(); };
for (const name of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'click', 'touchstart', 'touchmove', 'change', 'resize']) {
  window.addEventListener(name, markDirty, { passive: true, capture: true });
}
controls.addEventListener('change', markDirty);
// Вкладка, открытая в фоне и показанная позже, перерисовывается сразу, без движения мыши.
document.addEventListener('visibilitychange', () => { if (!document.hidden) markDirty(); });
window.addEventListener('focus', markDirty);
window.addEventListener('pageshow', markDirty);
THREE.DefaultLoadingManager.onProgress = (url, loaded, total) => {
  if (loadingNote && total) loadingNote.textContent = `Загрузка модели… ${Math.round(loaded / total * 100)}%`;
  markDirty();
};
const loadingNote = document.querySelector('#loading');
const hideLoading = () => { if (loadingNote) loadingNote.hidden = true; markDirty(); };
THREE.DefaultLoadingManager.onLoad = hideLoading;
setTimeout(hideLoading, 20000);
function applyPixelRatio(value) {
  pixelRatio = value;
  renderer.setPixelRatio(value);
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer?.setPixelRatio(value);
  composer?.setSize(window.innerWidth, window.innerHeight);
}
// Счётчик кадров для проверки на разных компьютерах: добавьте ?fps=1 к адресу. Показывает частоту, время кадра (среднее и 95%), разрешение и нагрузку.
const fpsPanel = new URLSearchParams(location.search).get('fps') === '1' ? (() => {
  const element = document.createElement('pre');
  element.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9;margin:0;padding:6px 8px;background:rgba(0,0,0,.72);color:#9fe8a0;font:11px/1.4 ui-monospace,monospace;pointer-events:none;border-radius:6px';
  document.body.appendChild(element);
  return element;
})() : null;
const fpsGaps = [];
let fpsShownAt = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const active = Boolean(cameraTransition) || now - lastActivity < 1800;
  const flagsLive = view === 'seat' && !reducedMotion && !panoMode;
  if (!active && !flagsLive) return;
  const gap = now - lastRender;
  if (gap < (active ? 15 : 50)) return;
  lastRender = now;
  if (fpsPanel && gap < 500) {
    fpsGaps.push(gap);
    if (now - fpsShownAt > 1000 && fpsGaps.length > 5) {
      fpsShownAt = now;
      const sorted = [...fpsGaps].sort((x, y) => x - y);
      const average = fpsGaps.reduce((sum, value) => sum + value, 0) / fpsGaps.length;
      fpsPanel.textContent = `${(1000 / average).toFixed(0)} fps · ${average.toFixed(1)} мс · p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)} мс\nразрешение ${pixelRatio.toFixed(2)}× · ${canvas.width}×${canvas.height}\nвызовов ${renderer.info.render.calls} · треугольников ${(renderer.info.render.triangles / 1e6).toFixed(2)} млн\nуровень ${tier}${tierInfo.ms ? ` (замер ${tierInfo.ms.toFixed(2)} мс)` : ''} · ${view}/${stage}${eveningMode ? ' · вечер' : ''}${composer ? ' · композитор' : ''}`;
      fpsGaps.length = 0;
    }
  }
  // Смена разрешения очищает холст, поэтому применяется в начале кадра, прямо перед отрисовкой: иначе мелькает пустой кадр.
  // Разрешение при переходах между видами не меняется: смена размера холста давала мигание текстур.
  const viewCap = maxPixelRatio;
  if (pendingPixelRatio !== null) {
    applyPixelRatio(pendingPixelRatio);
    pendingPixelRatio = null;
  }
  if (cameraTransition) {
    const transition = cameraTransition;
    const progress = transition.duration ? Math.min((now - transition.start) / transition.duration, 1) : 1;
    // Кубическая ease in-out (как в облётах Halden Arena): плавный старт и мягкая остановка.
    const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    camera.position.lerpVectors(transition.fromPosition, transition.toPosition, ease);
    camera.quaternion.slerpQuaternions(transition.fromRotation, transition.toRotation, ease);
    camera.fov = THREE.MathUtils.lerp(transition.fromFov, transition.toFov, ease);
    camera.updateProjectionMatrix();
    if (progress === 1) {
      controls.enabled = transition.orbit;
      cameraTransition = null;
    }
  }
  // Динамическая ближняя плоскость: на больших расстояниях слои с разницей в сантиметры не мерцают (z-fighting).
  // Считается и во время облёта (раньше в полёте ближняя плоскость падала до 0,1 м: слои земли мерцали и пропадали, пока камера не доходила до конца).
  const flightDistance = camera.position.y > 30 ? camera.position.length() : 0;
  const nearPlane = flightDistance > 40 ? Math.min(flightDistance * 0.02, 8) : 0.1;
  if (Math.abs(camera.near - nearPlane) > 0.01) {
    camera.near = nearPlane;
    camera.updateProjectionMatrix();
  }
  if (!reducedMotion) {
    const clock = now / 1000;
    for (const flag of cornerFlags) {
      flag.rotation.y = Math.sin(clock * 2.2 + flag.userData.phase) * 0.35;
      flag.rotation.z = Math.sin(clock * 3.1 + flag.userData.phase) * 0.06;
    }
  }
  if (controls.enabled) controls.update();
  const showingPano = panoMode && view === 'seat';
  // Композитор нужен для GTAO (только ?quality=max) и для свечения вечером; днём кадр рисуется напрямую.
  const aoActive = composer && !showingPano && now >= aoPausedUntil && (qualityMax || eveningMode);
  if (showingPano) renderer.render(panoScene, camera);
  else if (aoActive) {
    aoCamera.copy(camera, false);
    aoCamera.layers.set(0);
    composer.render();
  }
  else renderer.render(scene, camera);

  // Адаптивное разрешение: держим около 60 кадров/с. Если не тянет, разрешение снижается; затенение при <22 кадров/с отключается.
  if (active && gap < 120) {
    frameTotal += gap;
    frameCount += 1;
    if (frameCount >= 40) {
      const average = frameTotal / frameCount;
      frameTotal = 0;
      frameCount = 0;
      if (aoActive && average > 21 && !qualityMax) {
        // Сначала жертвуем затенением, а не чёткостью: картинка остаётся резкой.
        aoStrikes += 1;
        if (aoStrikes >= 2) {
          // Затенение отключается на 90 секунд (возможно, вкладку лишь притормозили); после трёх пауз отключается совсем.
          aoStrikes = 0;
          aoPauses += 1;
          aoPausedUntil = now + 90000;
          if (aoPauses >= 3) composer = null;
        }
      } else if (average > 19 && pixelRatio > minPixelRatio && now - lastResolutionChange > 1200) {
        const justRaised = now - lastRaise < 4000;
        pixelCeiling = Math.max(minPixelRatio, pixelRatio * 0.9);
        pendingPixelRatio = pixelCeiling;
        pixelRatio = pixelCeiling;
        lastResolutionChange = now;
        markDirty();
        if (justRaised) noRaiseUntil = now + 30000;
      } else if (average < 17.6 && pixelRatio < viewCap && now > noRaiseUntil && now - lastRaise > 8000) {
        pendingPixelRatio = Math.min(viewCap, pixelRatio + 0.1);
        pixelRatio = pendingPixelRatio;
        lastRaise = now;
        markDirty();
        lastResolutionChange = now;
      }
    }
  }
});

// Переключатель времени суток: день и вечер (вечерний свет приблизительный).
{
  const presets = {
    day: { sun: '#fff0d0', sunPower: 2.6, sunPosition: [-85, 140, -70], sky: '#f4f1e2', ground: '#4a5c5a', fill: 0.75, exposure: 1.05, env: 0.45, backdrop: 1, lamps: 0.6 },
    evening: { sun: '#ff9f55', sunPower: 0.7, sunPosition: [-150, 38, -40], sky: '#8f9cc4', ground: '#3b3a4a', fill: 0.5, exposure: 0.95, env: 0.22, backdrop: 0.38, lamps: 1.1 },
  };
  // Прожекторы: четыре мачты по углам освещают поле и трибуны тёплым белым светом (только вечером, без теней).
  const fieldLights = [];
  for (const x of mastXs) {
    for (const z of [mastZ]) {
      const spot = new THREE.SpotLight('#fff1d6', 34000, 0, 0.62, 0.7, 2);
      spot.position.set(x, 38.5, z);
      spot.target.position.set(0, 0, 0);
      spot.visible = false;
      scene.add(spot, spot.target);
      fieldLights.push(spot);
    }
  }
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'День';
  toggle.setAttribute('aria-label', 'Переключить время суток');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.className = 'time-toggle';
  // Ореолы вокруг прожекторов: видны только вечером.
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64;
  glowCanvas.height = 64;
  const glowContext = glowCanvas.getContext('2d');
  const glowGradient = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  glowGradient.addColorStop(0, 'rgba(255,244,208,1)');
  glowGradient.addColorStop(0.3, 'rgba(255,230,170,0.45)');
  glowGradient.addColorStop(1, 'rgba(255,220,150,0)');
  glowContext.fillStyle = glowGradient;
  glowContext.fillRect(0, 0, 64, 64);
  const glowPositions = [];
  const lampMatrix = new THREE.Matrix4();
  const lampPosition = new THREE.Vector3();
  for (let i = 0; i < floodlights.count; i += 1) {
    floodlights.getMatrixAt(i, lampMatrix);
    lampPosition.setFromMatrixPosition(lampMatrix);
    glowPositions.push(lampPosition.x, lampPosition.y, lampPosition.z);
  }
  const glowGeometry = new THREE.BufferGeometry();
  glowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(glowPositions, 3));
  const glow = new THREE.Points(glowGeometry, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(glowCanvas), size: 2.4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.visible = false;
  scene.add(glow);
  let mode = 'day';
  toggle.addEventListener('click', () => {
    mode = mode === 'day' ? 'evening' : 'day';
    const preset = presets[mode];
    toggle.textContent = mode === 'day' ? 'День' : 'Вечер';
    toggle.setAttribute('aria-pressed', String(mode === 'evening'));
    sun.color.set(preset.sun);
    sun.intensity = preset.sunPower;
    sun.position.set(...preset.sunPosition);
    hemisphere.color.set(preset.sky);
    hemisphere.groundColor.set(preset.ground);
    hemisphere.intensity = preset.fill;
    renderer.toneMappingExposure = preset.exposure;
    scene.environmentIntensity = preset.env;
    scene.backgroundIntensity = preset.backdrop;
    floodlights.material.emissiveIntensity = preset.lamps;
    eveningMode = mode === 'evening';
    for (const spot of fieldLights) spot.visible = eveningMode;
    if (eveningMode) loadEveningLight();
    aoUniforms.uLightAmount.value = eveningMode ? 0.9 : 0;
    for (const spot of fieldLights) spot.intensity = 2500;
    if (bloomPass) bloomPass.enabled = eveningMode;
    glow.visible = mode === 'evening';
    glow.material.opacity = mode === 'evening' ? 0.4 : 0;
    renderer.shadowMap.needsUpdate = true;
  });
  document.body.appendChild(toggle);
}

// Ссылка на место: #трибуна/сектор/ряд/место (например #west/5/7/12). Открывается сразу в виде с места.
function updateHash() {
  if (view === 'seat' && selectedSeat) history.replaceState(null, '', `${location.pathname}${location.search}#${selectedSeat.stand}/${selectedSeat.sector}/${selectedSeat.row}/${selectedSeat.number}`);
  else if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}
function openFromHash(hash = initialHash) {
  const [stand, sector, row, number] = hash.replace('#', '').split('/');
  if (!standNames[stand]) return;
  const seat = seats.find((item) => !item.hidden && item.stand === stand && item.sector === Number(sector) && item.row === Number(row) && item.number === Number(number));
  if (!seat) return;
  openBooking(stand);
  selectSector(seat.sector);
  chooseSeat(seat);
  showSeat();
}
openFromHash();
// Ссылка на место, вставленная в адресную строку уже открытой вкладки (меняется только #): открываем без перезагрузки.
window.addEventListener('hashchange', () => { if (location.hash) openFromHash(location.hash); });
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !bookingOpen) return;
  if (view === 'seat') document.querySelector('#preview-back').click();
  else if (stage === 'confirm') document.querySelector('#seat-change').click();
  else if (stage === 'sector') document.querySelector('#stand-view').click();
  else document.querySelector('#close-booking').click();
  updateHash();
});
document.querySelector('#close-booking').addEventListener('click', updateHash);

// Кэш панорам в браузере (только в собранной версии): повторные заходы быстрее и дешевле по трафику.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register(asset('sw.js')).catch(() => {}));
}

// Соседние места: в виде с места стрелки (и кнопки) переходят к креслу слева/справа и на ряд выше/ниже, чтобы сравнить виды.
function neighborSeat(dRow, dNumber) {
  if (!selectedSeat) return null;
  const here = selectedSeat;
  const inSector = seats.filter((seat) => !seat.hidden && seat.stand === here.stand && seat.sector === here.sector);
  const wantedRow = here.row + dRow;
  const sameRow = inSector.filter((seat) => seat.row === wantedRow);
  if (!sameRow.length) return null;
  if (dRow === 0) return sameRow.filter((seat) => (dNumber > 0 ? seat.number > here.number : seat.number < here.number))
    .sort((a, b) => (dNumber > 0 ? a.number - b.number : b.number - a.number))[0] || null;
  // На другой ряд: место с ближайшим положением вдоль ряда.
  return sameRow.sort((a, b) => a.position.distanceToSquared(here.position) - b.position.distanceToSquared(here.position))[0];
}
function goToNeighbor(dRow, dNumber) {
  if (view !== 'seat') return;
  const seat = neighborSeat(dRow, dNumber);
  if (!seat) return;
  chooseSeat(seat);
  showSeat();
}
window.addEventListener('keydown', (event) => {
  if (view !== 'seat' || !bookingOpen || event.target.closest?.('select, input')) return;
  const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, 0], ArrowDown: [-1, 0] };
  if (!moves[event.key]) return;
  event.preventDefault();
  goToNeighbor(...moves[event.key]);
});
for (const [id, move] of [['#seat-prev', [0, -1]], ['#seat-next', [0, 1]]]) {
  document.querySelector(id)?.addEventListener('click', () => goToNeighbor(...move));
}

// Главный фасад: собственная модель по фотографии-ориентиру (work/blender/create_west_facade.py), стоит снаружи западной трибуны.
modelLoader.load(asset('west-facade.glb'), (model) => {
  model.scene.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  scene.add(model.scene);
  renderer.shadowMap.needsUpdate = true;
  markDirty();
}, undefined, (error) => console.error('Не удалось загрузить фасад:', error));
