import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import horizon from './horizon.json';
import surroundings from './surroundings.json';
import greenery from './greenery.json';
import './style.css';

const canvas = document.querySelector('#stadium');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  document.querySelector('#error').hidden = false;
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
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
scene.add(new THREE.Mesh(horizonGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));

new HDRLoader().load('/sky.hdr', (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = texture;
  scene.environment = texture;
  scene.environmentIntensity = 0.45;
}, undefined, (error) => console.error('Не удалось загрузить небо', error));
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 7500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 90;
controls.maxDistance = 390;
controls.maxPolarAngle = Math.PI / 2.2;
controls.target.set(0, 4, 0);
const hemisphere = new THREE.HemisphereLight('#f4f1e2', '#4a5c5a', 0.75);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight('#fff0d0', 2.6);
sun.position.set(-85, 140, -70);
sun.castShadow = true;
const shadowSize = window.matchMedia('(pointer: coarse)').matches ? 2048 : 4096;
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
const grassTexture = new THREE.TextureLoader().load('/sports-turf.jpg', undefined, undefined, (error) => console.error('Не удалось загрузить текстуру газона', error));
grassTexture.colorSpace = THREE.SRGBColorSpace;
grassTexture.wrapS = THREE.RepeatWrapping;
grassTexture.wrapT = THREE.RepeatWrapping;
grassTexture.repeat.set(25, 16);
grassTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
const grass = new THREE.MeshStandardMaterial({ map: grassTexture, roughness: 1 });
const concreteTexture = new THREE.TextureLoader().load('/rough-concrete.jpg', undefined, undefined, (error) => console.error('Не удалось загрузить текстуру', error));
concreteTexture.colorSpace = THREE.SRGBColorSpace;
concreteTexture.wrapS = THREE.RepeatWrapping;
concreteTexture.wrapT = THREE.RepeatWrapping;
concreteTexture.repeat.set(5, 2);
concreteTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
const concrete = new THREE.MeshStandardMaterial({ color: '#b2b7b1', map: concreteTexture, roughness: 1 });
const darkConcrete = new THREE.MeshStandardMaterial({ color: '#99a29c', map: concreteTexture, roughness: 1 });
// Выцветание и разводы бетона: шум по мировым координатам, без отдельных текстур.
function weather(surface) {
  surface.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWeatherPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeatherPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWeatherPos;
float wHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float wNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wHash(i), wHash(i + vec3(1,0,0)), f.x), mix(wHash(i + vec3(0,1,0)), wHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wHash(i + vec3(0,0,1)), wHash(i + vec3(1,0,1)), f.x), mix(wHash(i + vec3(0,1,1)), wHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float stain = wNoise(vWeatherPos * 0.35) * 0.6 + wNoise(vWeatherPos * 1.7) * 0.3 + wNoise(vWeatherPos * 7.0) * 0.1;
diffuseColor.rgb *= mix(0.72, 1.08, stain);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 0.9, 0.84), smoothstep(0.55, 0.8, wNoise(vWeatherPos * 0.9)));`);
  };
  surface.needsUpdate = true;
}
weather(concrete);
weather(darkConcrete);
const trackNormal = new THREE.TextureLoader().load('/track-normal.jpg', undefined, undefined, (error) => console.error('Не удалось загрузить фактуру дорожек', error));
trackNormal.wrapS = THREE.RepeatWrapping;
trackNormal.wrapT = THREE.RepeatWrapping;
trackNormal.repeat.set(0.5, 0.5);
trackNormal.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
const track = new THREE.MeshStandardMaterial({ color: '#405a70', roughness: 0.95, normalMap: trackNormal, normalScale: new THREE.Vector2(0.5, 0.5) });
const white = material('#e8ead9');
const yellowSeats = material('#e0a617', 0.5);
const blueSeats = material('#1f5fa8', 0.5);
const greenSeats = material('#2f8f6a', 0.5);
const steel = material('#d8dbd2', 0.55);

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

function roundedPath(halfWidth, halfDepth, radius, path = new THREE.Path()) {
  path.moveTo(-halfWidth + radius, -halfDepth);
  path.lineTo(halfWidth - radius, -halfDepth);
  path.quadraticCurveTo(halfWidth, -halfDepth, halfWidth, -halfDepth + radius);
  path.lineTo(halfWidth, halfDepth - radius);
  path.quadraticCurveTo(halfWidth, halfDepth, halfWidth - radius, halfDepth);
  path.lineTo(-halfWidth + radius, halfDepth);
  path.quadraticCurveTo(-halfWidth, halfDepth, -halfWidth, halfDepth - radius);
  path.lineTo(-halfWidth, -halfDepth + radius);
  path.quadraticCurveTo(-halfWidth, -halfDepth, -halfWidth + radius, -halfDepth);
  return path;
}

function ring(outerWidth, outerDepth, innerWidth, innerDepth, radius, height, surface, thickness = 0) {
  const shape = roundedPath(outerWidth, outerDepth, radius, new THREE.Shape());
  shape.holes.push(roundedPath(innerWidth, innerDepth, Math.max(radius - (outerWidth - innerWidth), 1)));
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
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(330, 270), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(contactCanvas), transparent: true, depthWrite: false }));
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
ring(70, 52, 54, 35, 29, 0.02, darkConcrete);
ring(65, 46, 54, 35, 26, 0.04, track);
for (let i = 0; i <= 8; i += 1) {
  ring(55 + i * 1.22, 36 + i * 1.22, 54.94 + i * 1.22, 35.94 + i * 1.22, 16 + i * 1.22, 0.07, white);
}
ring(94, 76, 69, 51, 38, 0.02, darkConcrete);
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
ring(70.7, 52.7, 70.4, 52.4, 29.3, 0.95, darkConcrete, 0.95);
ring(70.4, 52.4, 70.38, 52.38, 29.0, 0.4, new THREE.MeshBasicMaterial({ color: '#4c9bff' }), 0.07);
ring(70.72, 52.72, 70.4, 52.4, 29.32, 1.0, steel, 0.05);

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
modelLoader.load('/alatau-terrain.glb', (model) => {
  model.scene.traverse((object) => {
    if (object.isMesh) object.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  });
  scene.add(model.scene);
}, undefined, (error) => console.error('Не удалось загрузить рельеф гор:', error));
modelLoader.load('/stadium-seat.glb', (model) => {
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
const detailCapacity = 2400;
let detailSeatGeometry = seatGeometry;
const detailMeshes = {
  yellow: new THREE.InstancedMesh(seatGeometry, yellowSeats, detailCapacity),
  blue: new THREE.InstancedMesh(seatGeometry, blueSeats, detailCapacity),
  green: new THREE.InstancedMesh(seatGeometry, greenSeats, detailCapacity),
};
const detailLegs = new THREE.InstancedMesh(supportGeometry, material('#59645e', 0.75), detailCapacity * 3);
const sectorHits = new THREE.InstancedMesh(hitGeometry, new THREE.MeshBasicMaterial(), detailCapacity * 3);
sectorHits.visible = false;
const sectorRefs = [];
for (const mesh of [...Object.values(detailMeshes), detailLegs, sectorHits]) {
  mesh.count = 0;
  mesh.frustumCulled = false;
}
scene.add(...Object.values(detailMeshes), detailLegs, sectorHits);
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
  if (row === 15) ring(83.68, 65.68, 81.68, 63.68, 41.58, y - 0.37, darkConcrete, 0.38);
  standLevels.push(ring(71.6 + step, 53.6 + step, 70.88 + step, 52.88 + step, 29.5 + step, y, row % 2 ? concrete : darkConcrete, 0.38));
  const path = roundedPath(71 + step, 53 + step, 29 + step);
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
    const stand = Math.abs(point.x) / (71 + step) > Math.abs(point.y) / (53 + step)
      ? (point.x > 0 ? 'north' : 'south')
      : (point.y > 0 ? 'west' : 'east');
    if (stand === 'east' && (row === 13 || row === 14)) continue;
    if (stand === 'west' && Math.abs(point.x) < 12.5 && point.y > 72.5) continue;
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
  const signMaterials = new Map();
  for (const [sector, entry] of topBySector) {
    const center = new THREE.Vector3();
    entry.items.forEach((position) => center.add(position));
    center.divideScalar(entry.items.length);
    const outward = new THREE.Vector3(center.x, 0, center.z).normalize();
    if (!signMaterials.has(sector)) {
      const signCanvas = document.createElement('canvas');
      signCanvas.width = 128;
      signCanvas.height = 64;
      const signContext = signCanvas.getContext('2d');
      signContext.fillStyle = '#14181a';
      signContext.fillRect(0, 0, 128, 64);
      signContext.strokeStyle = '#e0a617';
      signContext.lineWidth = 4;
      signContext.strokeRect(2, 2, 124, 60);
      signContext.fillStyle = '#f4f1e2';
      signContext.font = '700 42px system-ui, sans-serif';
      signContext.textAlign = 'center';
      signContext.textBaseline = 'middle';
      signContext.fillText(String(sector), 64, 35);
      const signTexture = new THREE.CanvasTexture(signCanvas);
      signTexture.colorSpace = THREE.SRGBColorSpace;
      signTexture.anisotropy = 4;
      signMaterials.set(sector, new THREE.MeshBasicMaterial({ map: signTexture }));
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), signMaterials.get(sector));
    sign.position.set(center.x + outward.x * 1.4, entry.y + 2.1, center.z + outward.z * 1.4);
    sign.lookAt(0, sign.position.y, 0);
    scene.add(sign);
  }
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

// Пропорции здания и навеса ориентировочные: измеренного чертежа пока нет.
modelLoader.load('/west-building.glb', (model) => {
  model.scene.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  scene.add(model.scene);
  renderer.shadowMap.needsUpdate = true;
}, undefined, (error) => console.error('Не удалось загрузить здание трибуны:', error));
modelLoader.load('/stadium-roof.glb', (model) => {
  model.scene.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  scene.add(model.scene);
  renderer.shadowMap.needsUpdate = true;
}, undefined, (error) => console.error('Не удалось загрузить модель навеса:', error));
const roofLights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.75, 0.16, 0.25), new THREE.MeshStandardMaterial({ color: '#f5f2df', emissive: '#e5e0c7', emissiveIntensity: 0.45 }), 33);
for (let i = 0; i < 33; i += 1) {
  helper.position.set(-48 + i * 3, 17.45, -58.3);
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
for (const z of [-4.5, 4.5]) box(1, 10, 1, -99, 5, z, scoreboardFrame);
box(1.2, 7.6, 15, -99, 13.8, 0, scoreboardFrame);
const scoreCanvas = document.createElement('canvas');
scoreCanvas.width = 1024;
scoreCanvas.height = 480;
const scoreContext = scoreCanvas.getContext('2d');
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
const scoreTexture = new THREE.CanvasTexture(scoreCanvas);
scoreTexture.colorSpace = THREE.SRGBColorSpace;
scoreTexture.anisotropy = 4;
const scoreLit = new THREE.MeshStandardMaterial({ map: scoreTexture, emissive: '#ffffff', emissiveMap: scoreTexture, emissiveIntensity: 0.9, roughness: 0.4 });
const scoreScreen = new THREE.Mesh(new THREE.BoxGeometry(0.08, 6.4, 13.7), [scoreLit, scoreboardScreen, scoreboardScreen, scoreboardScreen, scoreboardScreen, scoreboardScreen]);
scoreScreen.position.set(-98.36, 13.8, 0);
scene.add(scoreScreen);
const towerLines = [];
const floodlights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.65, 0.5, 0.22), new THREE.MeshStandardMaterial({ color: '#ecede4', emissive: '#fff3d0', emissiveIntensity: 0.6 }), 84);
let lightIndex = 0;
for (const x of [-102, 102]) {
  for (const z of [-90, 90]) {
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        towerLines.push(x + dx * 1.4, 0, z + dz * 1.4, x + dx * 0.7, 30, z + dz * 0.7);
      }
    }
    for (let y = 0; y < 30; y += 3) {
      const lower = 1.4 - y * 0.7 / 30;
      const upper = 1.4 - (y + 3) * 0.7 / 30;
      for (const side of [-1, 1]) {
        towerLines.push(x + side * lower, y, z - lower, x + side * upper, y + 3, z + upper);
        towerLines.push(x - lower, y, z + side * lower, x + upper, y + 3, z + side * upper);
      }
    }
    const angle = Math.atan2(-x, -z);
    const panel = box(7, 3.2, 0.35, x, 31.2, z, steel);
    panel.rotation.y = angle;
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 7; column += 1) {
        const along = (column - 3) * 0.85;
        helper.position.set(x + Math.cos(angle) * along + Math.sin(angle) * 0.3, 30.35 + row * 0.85, z - Math.sin(angle) * along + Math.cos(angle) * 0.3);
        helper.rotation.set(0, angle, 0);
        helper.updateMatrix();
        floodlights.setMatrixAt(lightIndex++, helper.matrix);
      }
    }
  }
}
const towerGeometry = new THREE.BufferGeometry();
towerGeometry.setAttribute('position', new THREE.Float32BufferAttribute(towerLines, 3));
scene.add(new THREE.LineSegments(towerGeometry, new THREE.LineBasicMaterial({ color: '#b7c3c0' })), floodlights);
floodlights.instanceMatrix.needsUpdate = true;
for (const z of [-50.5, 50.5]) {
  for (let x = -48; x <= 48; x += 4) box(0.06, 1.1, 0.06, x, 0.7, z, steel);
  for (const y of [0.5, 1.15]) box(96, 0.06, 0.06, 0, y, z, steel);
}

const views = {
  overview: { label: 'Общий вид', position: [180, 155, 220] },
  west: { label: 'Западная трибуна', position: [0, 12, 30], target: [0, 8, -70] },
  east: { label: 'Восточная трибуна', position: [0, 27, -38], target: [0, 5, 70] },
  north: { label: 'Северная трибуна', position: [-38, 27, 0], target: [82, 5, 0] },
  south: { label: 'Южная трибуна', position: [38, 27, 0], target: [-82, 5, 0] },
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
function moveCamera(position, target, fov, orbit) {
  const destination = camera.clone();
  destination.position.copy(position);
  destination.lookAt(target);
  controls.enabled = false;
  if (orbit) controls.target.copy(target);
  const duration = firstView || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 850;
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
function setView(name) {
  view = name;
  stage = 'stand';
  applyDetail('none');
  clearMarker();
  const selected = views[name];
  const target = name === 'overview' ? new THREE.Vector3(0, 4, 0) : new THREE.Vector3(...selected.target);
  moveCamera(new THREE.Vector3(...selected.position), target, name === 'overview' ? 38 : 50, name === 'overview');
  updateCameraFraming();
  updateSeatHighlights();
  document.querySelector('#app').classList.toggle('seat-mode', name !== 'overview');
  document.querySelector('#current-view').textContent = selected.label;
  document.querySelector('#hint').textContent = name === 'overview' ? 'Выберите трибуну' : 'Нажмите на сектор';
  document.querySelectorAll('.view-button').forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (bookingOpen) renderStage();
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
      const active = !bookingOpen || view === 'seat' || seat.stand === standSelect.value;
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
function applyDetail(mode, origin) {
  const picked = [];
  if (mode === 'sector') {
    const sector = Number(sectorSelect.value);
    for (const seat of seats) if (!seat.hidden && seat.stand === standSelect.value && seat.sector === sector) picked.push(seat);
  } else if (mode === 'near') {
    for (const seat of seats) if (!seat.hidden && seat.position.distanceToSquared(origin) < 24 * 24) picked.push(seat);
  }
  const chosen = new Set(picked);
  const mainVisible = mode !== 'sector';
  for (const [mesh, data] of [[yellow, yellowData], [blue, blueData], [green, greenData]]) {
    mesh.visible = mainVisible;
    if (!mainVisible) continue;
    data.forEach((seat, index) => mesh.setMatrixAt(index, !seat.hidden && !chosen.has(seat) ? seat.matrix : hiddenMatrix));
    mesh.instanceMatrix.needsUpdate = true;
  }
  const counts = { yellow: 0, blue: 0, green: 0 };
  let legs = 0;
  sectorRefs.length = 0;
  for (const seat of picked) {
    if (counts[seat.group] >= detailCapacity) continue;
    detailMeshes[seat.group].setMatrixAt(counts[seat.group]++, seat.matrix);
    detailLegs.setMatrixAt(legs++, seat.matrix);
    sectorHits.setMatrixAt(sectorRefs.length, seat.matrix);
    sectorRefs.push(seat);
  }
  for (const [group, mesh] of Object.entries(detailMeshes)) {
    mesh.count = counts[group];
    mesh.instanceMatrix.needsUpdate = true;
  }
  detailLegs.count = legs;
  detailLegs.instanceMatrix.needsUpdate = true;
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
  document.querySelector('#panel-title').textContent = stage === 'seat' ? 'Вид с места'
    : stage === 'stand' ? standNames[standSelect.value]
    : `${standNames[standSelect.value]} · сектор ${sector}`;
  document.querySelector('#stage-stand').hidden = stage !== 'stand';
  document.querySelector('#stage-sector').hidden = stage !== 'sector';
  document.querySelector('#stage-confirm').hidden = stage !== 'confirm';
  document.querySelector('#sector-copy').textContent = `Нажмите на место в секторе ${sector}. Остальные сектора скрыты.`;
  if (stage === 'confirm' && selectedSeat) document.querySelector('#confirm-place').textContent = currentPlace();
  const chips = document.querySelector('#sector-chips');
  chips.replaceChildren(...standSectors[standSelect.value].map((number) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = String(number);
    chip.setAttribute('aria-label', `Сектор ${number}`);
    chip.addEventListener('click', () => selectSector(number));
    return chip;
  }));
  document.querySelector('#hint').textContent = { stand: 'Нажмите на сектор', sector: 'Нажмите на место', confirm: 'Подтвердите место в панели', seat: 'Перетащите, чтобы осмотреться' }[stage] || '';
}
function selectSector(sector) {
  updateSectorOptions(sector);
  stage = 'sector';
  clearMarker();
  applyDetail('sector');
  showSector();
  renderStage();
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
function showSeat() {
  if (!selectedSeat) return;
  view = 'seat';
  stage = 'seat';
  clearMarker();
  updateSeatHighlights();
  const position = selectedSeat.position.clone().add(new THREE.Vector3(0, 1, 0));
  applyDetail('near', position);
  yaw = Math.atan2(-position.z, -position.x);
  initialYaw = yaw;
  pitch = -0.12;
  const direction = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
  moveCamera(position, position.clone().add(direction), 64, false);
  updateCameraFraming();
  document.querySelector('#preview-place').textContent = currentPlace();
  showBookingStep('preview');
  renderStage();
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
document.querySelector('#open-booking').addEventListener('click', () => openBooking(standSelect.value));
document.querySelector('#close-booking').addEventListener('click', () => {
  bookingOpen = false;
  document.querySelector('#app').classList.remove('booking-open');
  document.querySelector('#booking-panel').hidden = true;
  setView('overview');
});
document.querySelector('#stand-view').addEventListener('click', () => setView(standSelect.value));
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
  yaw = THREE.MathUtils.clamp(yaw, initialYaw - 0.6, initialYaw + 0.6);
  pitch = THREE.MathUtils.clamp(pitch + (event.clientY - lastY) * 0.004, -0.35, 0.35);
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
    const hit = raycaster.intersectObjects(standLevels)[0];
    if (!hit) return;
    const point = hit.point;
    const stand = Math.abs(point.x) / 80 > Math.abs(point.z) / 62
      ? (point.x > 0 ? 'north' : 'south')
      : (point.z < 0 ? 'west' : 'east');
    openBooking(stand);
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
  if (dragging || cameraTransition || !bookingOpen || view === 'seat' || stage === 'stand' || event.pointerType === 'touch') {
    if (!seatTip.hidden) { seatTip.hidden = true; canvas.style.cursor = ''; }
    return;
  }
  const now = performance.now();
  if (now - hoverFrame < 40) return;
  hoverFrame = now;
  const bounds = canvas.getBoundingClientRect();
  hoverPointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  hoverRaycaster.setFromCamera(hoverPointer, camera);
  const hit = hoverRaycaster.intersectObject(sectorHits)[0];
  const seat = hit && sectorRefs[hit.instanceId];
  if (!seat || seat.hidden) {
    seatTip.hidden = true;
    canvas.style.cursor = '';
    return;
  }
  seatTip.textContent = `Ряд ${seat.row} · место ${seat.number}`;
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
setView('overview');
// Затенение в контактах (ambient occlusion): тёмные стыки между рядами, креслами и ступенями.
// Включается только на десктопе; ?fx=0 в адресе отключает эффект.
if (location.search.includes('debug')) window.__debug = { renderer, scene, camera };
const fpsWindow = { start: performance.now(), last: performance.now(), frames: 0, checks: 0 };
let composer;
if (!window.matchMedia('(pointer: coarse)').matches && new URLSearchParams(location.search).get('fx') !== '0') {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
  ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 16 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
  composer.addPass(ao);
  composer.addPass(new OutputPass());
}
renderer.setAnimationLoop(() => {
  if (cameraTransition) {
    const transition = cameraTransition;
    const progress = transition.duration ? Math.min((performance.now() - transition.start) / transition.duration, 1) : 1;
    const ease = progress * progress * (3 - 2 * progress);
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
  const orbitDistance = controls.enabled && !cameraTransition ? camera.position.distanceTo(controls.target) : 0;
  const nearPlane = orbitDistance > 40 ? Math.min(orbitDistance * 0.02, 8) : 0.1;
  if (Math.abs(camera.near - nearPlane) > 0.01) {
    camera.near = nearPlane;
    camera.updateProjectionMatrix();
  }
  const clock = performance.now() / 1000;
  for (const flag of reducedMotion ? [] : cornerFlags) {
    flag.rotation.y = Math.sin(clock * 2.2 + flag.userData.phase) * 0.35;
    flag.rotation.z = Math.sin(clock * 3.1 + flag.userData.phase) * 0.06;
  }
  if (controls.enabled) controls.update();
  if (composer) {
    // Если видеокарта не тянет затенение (меньше 22 кадров/с за 3 секунды), эффект отключается сам.
    const stamp = performance.now();
    // Пауза (вкладка была скрыта) не считается медленной работой: окно измерения начинается заново.
    if (stamp - fpsWindow.last > 500) { fpsWindow.start = stamp; fpsWindow.frames = 0; }
    fpsWindow.last = stamp;
    if (stamp - fpsWindow.start > 3000) {
      if (fpsWindow.frames > 0 && fpsWindow.frames / ((stamp - fpsWindow.start) / 1000) < 22 && fpsWindow.checks > 0) composer = null;
      fpsWindow.start = stamp;
      fpsWindow.frames = 0;
      fpsWindow.checks += 1;
    }
    fpsWindow.frames += 1;
  }
  if (composer) composer.render();
  else renderer.render(scene, camera);
});

// Переключатель времени суток: день и вечер (вечерний свет приблизительный).
{
  const presets = {
    day: { sun: '#fff0d0', sunPower: 2.6, sunPosition: [-85, 140, -70], sky: '#f4f1e2', ground: '#4a5c5a', fill: 0.75, exposure: 1.05, env: 0.45, backdrop: 1, lamps: 0.6 },
    evening: { sun: '#ff9f55', sunPower: 1.5, sunPosition: [-150, 38, -40], sky: '#8f9cc4', ground: '#3b3a4a', fill: 0.5, exposure: 0.95, env: 0.22, backdrop: 0.38, lamps: 2.4 },
  };
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
  const glow = new THREE.Points(glowGeometry, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(glowCanvas), size: 7, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
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
    glow.visible = mode === 'evening';
    glow.material.opacity = mode === 'evening' ? 0.85 : 0;
    renderer.shadowMap.needsUpdate = true;
  });
  document.body.appendChild(toggle);
}
