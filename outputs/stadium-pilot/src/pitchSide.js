// Предметы у поля: рекламные щиты, скамейки запасных и мелкий инвентарь площадки.
// Всё нарисовано кодом (свои макеты, без чужих брендов и ассетов); расположение предположительное.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// Коробка из двух групп: лицевая грань (-z или обе по z) со своим материалом, остальные одним вызовом отрисовки.
function facedBox(width, height, depth, firstFaceIndex) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.clearGroups();
  geometry.addGroup(0, firstFaceIndex * 6, 0);
  geometry.addGroup(firstFaceIndex * 6, (6 - firstFaceIndex) * 6, 1);
  return geometry;
}

function canvasTexture(canvas, anisotropy) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

// Надпись по центру отведённой ширины; длинная ужимается по горизонтали.
function fitText(context, text, x, y, maxWidth, size, color, weight = 800) {
  context.font = `${weight} ${size}px ${FONT}`;
  context.fillStyle = color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, x, y, maxWidth);
}

function mountainMark(context, x, y, color, snow) {
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(x - 38, y + 24);
  context.lineTo(x - 10, y - 22);
  context.lineTo(x + 4, y);
  context.lineTo(x + 15, y - 14);
  context.lineTo(x + 40, y + 24);
  context.closePath();
  context.fill();
  context.fillStyle = snow;
  context.beginPath();
  context.moveTo(x - 20, y - 6);
  context.lineTo(x - 10, y - 22);
  context.lineTo(x - 1, y - 8);
  context.lineTo(x - 7, y - 11);
  context.lineTo(x - 12, y - 4);
  context.closePath();
  context.fill();
}

function chevrons(context, x, color) {
  context.fillStyle = color;
  for (let i = 0; i < 3; i += 1) {
    const left = x + i * 22;
    context.beginPath();
    context.moveTo(left, 26);
    context.lineTo(left + 14, 26);
    context.lineTo(left + 32, 56);
    context.lineTo(left + 14, 86);
    context.lineTo(left, 86);
    context.lineTo(left + 18, 56);
    context.closePath();
    context.fill();
  }
}

const PANEL_WIDTH = 512;
const PANEL_HEIGHT = 112;

function drawBoardStrip() {
  const panels = [
    { from: '#0f2342', to: '#1b3a66', draw: (c) => { mountainMark(c, 62, 56, '#e0a617', '#f6f3e8'); fitText(c, 'ЦЕНТРАЛЬНЫЙ СТАДИОН', 304, 58, 380, 42, '#f6f3e8'); } },
    { from: '#f4f2ea', to: '#e6e3d8', draw: (c) => { chevrons(c, 24, '#c9362f'); fitText(c, 'ВАША РЕКЛАМА', 300, 58, 370, 52, '#14233a'); } },
    { from: '#a81f22', to: '#d2402f', draw: (c) => { fitText(c, 'АЛҒА, АЛМАТЫ!', 256, 58, 440, 60, '#fff6ec', 900); c.fillStyle = '#f0b429'; c.fillRect(36, 94, 440, 6); } },
    { from: '#e7a90f', to: '#f5c63a', draw: (c) => { fitText(c, 'СПОРТ ДЛЯ ВСЕХ', 220, 58, 360, 50, '#1a1d1f', 900); [[34, '#1a1d1f'], [22, '#f0bb27'], [10, '#1a1d1f']].forEach(([radius, color]) => { c.fillStyle = color; c.beginPath(); c.arc(452, 56, radius, 0, Math.PI * 2); c.fill(); }); } },
    { from: '#07343a', to: '#0f6d6c', draw: (c) => { fitText(c, 'АЛМАТЫ', 256, 48, 420, 62, '#ffffff', 900); fitText(c, 'ГОРОД У ГОР', 256, 90, 420, 22, '#9fe0d6', 600); mountainMark(c, 66, 56, '#9fe0d6', '#ffffff'); mountainMark(c, 446, 56, '#9fe0d6', '#ffffff'); } },
    { from: '#14603f', to: '#238a5b', draw: (c) => { fitText(c, 'ЧЕСТНАЯ ИГРА', 292, 58, 390, 52, '#f2fbf4'); c.strokeStyle = '#f2fbf4'; c.lineWidth = 7; c.beginPath(); c.arc(60, 56, 28, 0, Math.PI * 2); c.moveTo(60, 28); c.lineTo(60, 84); c.stroke(); } },
    { from: '#123f8c', to: '#1f6fc4', draw: (c) => { fitText(c, 'БІЗ БІРГЕМІЗ', 256, 58, 400, 54, '#ffffff', 900); c.fillStyle = '#7fd0ff'; c.fillRect(22, 24, 10, 64); c.fillRect(480, 24, 10, 64); } },
    { from: '#171b1e', to: '#2a3136', draw: (c) => { fitText(c, 'ЗДЕСЬ МОЖЕТ БЫТЬ', 256, 38, 430, 30, '#c7d0d4', 700); fitText(c, 'ВАШ БРЕНД', 256, 78, 430, 46, '#f0b429', 900); } },
  ];
  const canvas = document.createElement('canvas');
  canvas.width = PANEL_WIDTH * panels.length;
  canvas.height = PANEL_HEIGHT;
  const context = canvas.getContext('2d');
  panels.forEach((panel, index) => {
    context.save();
    context.translate(index * PANEL_WIDTH, 0);
    const gradient = context.createLinearGradient(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    gradient.addColorStop(0, panel.from);
    gradient.addColorStop(1, panel.to);
    context.fillStyle = gradient;
    context.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    panel.draw(context);
    // Стыки светодиодных кабинетов.
    context.fillStyle = '#0b0e10';
    context.fillRect(0, 0, 2, PANEL_HEIGHT);
    context.fillRect(PANEL_WIDTH - 2, 0, 2, PANEL_HEIGHT);
    context.restore();
  });
  return canvas;
}

export function createBoards({ scene, anisotropy }) {
  const strip = canvasTexture(drawBoardStrip(), anisotropy);
  strip.wrapS = THREE.RepeatWrapping;
  const metresPerStrip = 0.82 * strip.image.width / strip.image.height;
  const cabinet = new THREE.MeshStandardMaterial({ color: '#14181b', roughness: 0.6 });
  const plinths = createParts();
  let start = 0;
  for (const [length, x, z, turn] of [[105, 0, -35.6, 0], [105, 0, 35.6, 0], [71, -54.4, 0, Math.PI / 2], [71, 54.4, 0, Math.PI / 2]]) {
    const texture = strip.clone();
    texture.repeat.set(length / metresPerStrip, 1);
    texture.offset.x = start;
    start += 0.375; // соседние стороны начинаются с разных макетов
    texture.needsUpdate = true;
    const face = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0.3 });
    // Грани 4 и 5 (+z и -z) — экраны, остальные — корпус.
    const screen = new THREE.Mesh(facedBox(length, 0.82, 0.12, 4), [cabinet, face]);
    screen.position.set(x, 0.5, z);
    screen.rotation.y = turn;
    screen.castShadow = true;
    plinths.box(length, 0.09, 0.2, '#14181b', x, 0.045, z, 0, turn);
    scene.add(screen);
  }
  scene.add(plinths.mesh(0.6, 0));
}

// Сборщик цветных деталей в одну геометрию: сотни мелких предметов обходятся одним вызовом отрисовки.
function createParts() {
  const parts = [];
  const color = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const add = (source, hex, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const geometry = source.index ? source.toNonIndexed() : source;
    color.set(hex);
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) color.toArray(colors, i * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.clearGroups();
    quaternion.setFromEuler(euler.set(rx, ry, rz));
    matrix.compose(new THREE.Vector3(x, y, z), quaternion, new THREE.Vector3(1, 1, 1));
    geometry.applyMatrix4(matrix);
    parts.push(geometry);
  };
  return {
    box: (w, h, d, hex, x, y, z, rx, ry, rz) => add(new THREE.BoxGeometry(w, h, d), hex, x, y, z, rx, ry, rz),
    cylinder: (top, bottom, h, hex, x, y, z, rx, ry, rz, segments = 10) => add(new THREE.CylinderGeometry(top, bottom, h, segments), hex, x, y, z, rx, ry, rz),
    // Тонкий стержень между двумя точками.
    rod(from, to, radius, hex) {
      const a = new THREE.Vector3(...from);
      const b = new THREE.Vector3(...to);
      const direction = b.clone().sub(a);
      const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 6);
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
      add(geometry, hex, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    },
    add,
    mesh(roughness = 0.62, metalness = 0.1) {
      const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    },
  };
}

function dugoutSign(title, accent, anisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 90;
  const context = canvas.getContext('2d');
  context.fillStyle = '#16222c';
  context.fillRect(0, 0, 1024, 90);
  context.fillStyle = accent;
  context.fillRect(0, 0, 1024, 9);
  fitText(context, title, 512, 50, 600, 46, '#f2f4f0');
  mountainMark(context, 90, 50, accent, '#f2f4f0');
  mountainMark(context, 934, 50, accent, '#f2f4f0');
  return canvasTexture(canvas, anisotropy);
}

// Скамейки запасных: изогнутый навес из дымчатого поликарбоната на дугах, отдельные кресла, табличка сзади.
// Сторона +z смотрит на поле, трибуна видит их сзади.
export function createDugouts({ scene, anisotropy }) {
  const z = -38.4;
  const parts = createParts();
  const shells = [];
  const glass = new THREE.MeshStandardMaterial({ color: '#7fa3b0', transparent: true, opacity: 0.34, roughness: 0.08, metalness: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const profile = new THREE.CatmullRomCurve3([[-0.88, 0.62], [-0.93, 1.25], [-0.72, 1.82], [-0.22, 2.14], [0.35, 2.22], [0.82, 2.12]].map(([dz, y]) => new THREE.Vector3(0, y, dz)));
  const points = profile.getPoints(24);
  const half = 3.5;
  const canopy = new THREE.BufferGeometry();
  const positions = [];
  const indices = [];
  points.forEach((point, index) => {
    positions.push(-half, point.y, point.z, half, point.y, point.z);
    if (index) {
      const base = (index - 1) * 2;
      indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    }
  });
  canopy.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  canopy.setIndex(indices);
  canopy.computeVertexNormals();
  const side = new THREE.Shape();
  side.moveTo(-0.88, 0.08);
  for (const point of points) side.lineTo(point.z, point.y);
  side.lineTo(0.15, 0.08);
  const sideGeometry = new THREE.ShapeGeometry(side);
  sideGeometry.rotateY(-Math.PI / 2); // ось x контура становится осью z
  sideGeometry.deleteAttribute('uv'); // чтобы склеить с навесом в один меш

  const backShape = new THREE.Shape();
  backShape.moveTo(-0.2, 0);
  backShape.lineTo(0.2, 0);
  backShape.lineTo(0.22, 0.36);
  backShape.quadraticCurveTo(0.2, 0.55, 0, 0.56);
  backShape.quadraticCurveTo(-0.2, 0.55, -0.22, 0.36);
  const seatBackGeometry = new THREE.ExtrudeGeometry(backShape, { depth: 0.045, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.018, bevelThickness: 0.018, curveSegments: 4 });

  for (const [x, title, accent, seatColor] of [[-10, 'ХОЗЯЕВА', '#e0a617', '#a8231d'], [10, 'ГОСТИ', '#5fb3e8', '#1d4f8f']]) {
    shells.push(canopy.clone().translate(x, 0, z));
    for (const dx of [-half, half]) shells.push(sideGeometry.clone().translate(x + dx, 0, z));
    // Каркас: дуги, продольные трубы и стойки.
    for (let i = 0; i <= 4; i += 1) {
      const dx = -half + i * half / 2;
      parts.add(new THREE.TubeGeometry(profile, 20, 0.032, 6), '#c9d0d3', x + dx, 0, z);
      parts.rod([x + dx, 0.05, z - 0.88], [x + dx, 0.64, z - 0.88], 0.032, '#c9d0d3');
    }
    parts.rod([x - half, 2.12, z + 0.82], [x + half, 2.12, z + 0.82], 0.045, '#c9d0d3');
    parts.rod([x - half, 1.82, z - 0.72], [x + half, 1.82, z - 0.72], 0.025, '#c9d0d3');
    parts.box(7.2, 0.08, 1.85, '#23292d', x, 0.07, z - 0.04);
    for (let i = 0; i < 12; i += 1) {
      const sx = x - 3.08 + i * 0.56;
      parts.box(0.44, 0.08, 0.42, seatColor, sx, 0.52, z - 0.36);
      parts.add(seatBackGeometry.clone(), seatColor, sx, 0.57, z - 0.58, -0.14);
      parts.box(0.08, 0.38, 0.08, '#8b949a', sx, 0.3, z - 0.42);
    }
    const sign = new THREE.Mesh(facedBox(7, 0.56, 0.05, 5), [
      new THREE.MeshStandardMaterial({ color: '#16222c', roughness: 0.55 }),
      new THREE.MeshStandardMaterial({ map: dugoutSign(title, accent, anisotropy), roughness: 0.55 }),
    ]);
    sign.position.set(x, 0.38, z - 0.9);
    sign.castShadow = true;
    scene.add(sign);
    // Ящики с водой и сумка врача рядом.
    parts.box(0.62, 0.42, 0.42, '#2368a8', x + 4.15, 0.28, z - 0.3);
    parts.box(0.66, 0.06, 0.46, '#e6ebee', x + 4.15, 0.52, z - 0.3);
    parts.box(0.5, 0.3, 0.3, '#b4302a', x - 4.05, 0.22, z - 0.5, 0, 0.3);
  }
  const shell = new THREE.Mesh(mergeGeometries(shells), glass);
  shell.castShadow = true;
  scene.add(shell, parts.mesh(0.5, 0.2));
}

function grateTexture(anisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  context.fillStyle = '#7d8688';
  context.fillRect(0, 0, 32, 32);
  context.fillStyle = '#1d2325';
  context.fillRect(4, 4, 9, 24);
  context.fillRect(20, 4, 9, 24);
  const texture = canvasTexture(canvas, anisotropy);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// Площадка вдоль длинных сторон: решётки стока, люки, кабельные дорожки, барьеры, камеры, урны, кофры.
// farZ — внешний край площадки у барьера трибуны.
export function createApronDetails({ scene, farZ, anisotropy }) {
  const parts = createParts();
  const grate = grateTexture(anisotropy);
  grate.repeat.set(78 / 0.24, 1);
  const grateMaterial = new THREE.MeshStandardMaterial({ map: grate, roughness: 0.55, metalness: 0.45 });
  const drain = new THREE.Mesh(mergeGeometries([-1, 1].map((side) => new THREE.PlaneGeometry(78, 0.34).rotateX(-Math.PI / 2).translate(0, 0.058, side * 46.56))), grateMaterial);
  drain.receiveShadow = true;
  scene.add(drain);
  for (const side of [-1, 1]) {
    // «Вглубь» — расстояние от центра поля; side переносит предмет на западную (-1) или восточную сторону.
    const at = (depth) => side * depth;
    const shift = side < 0 ? 0 : 5.5;
    // Жёлтая линия безопасности у барьера и кабельная дорожка вдоль ограждения.
    parts.box(88, 0.012, 0.1, '#c79a14', 0, 0.034, at(farZ - 1.35));
    parts.box(84, 0.045, 0.16, '#202527', 0, 0.045, at(49.75));
    for (let x = -40; x <= 40; x += 8) parts.box(0.5, 0.05, 0.18, '#d6a514', x, 0.047, at(49.75));
    // Люки: квадратные у ограждения, круглые ближе к трибуне.
    for (let x = -37 + shift; x <= 38; x += 12.5) {
      parts.box(0.92, 0.018, 0.92, '#4a5154', x, 0.03, at(52.4));
      parts.box(0.78, 0.022, 0.78, '#70787a', x, 0.031, at(52.4));
      for (const d of [-0.22, 0, 0.22]) parts.box(0.62, 0.026, 0.035, '#555d60', x, 0.032, at(52.4 + d));
    }
    for (let x = -30.5 + shift; x <= 34; x += 17) {
      parts.cylinder(0.42, 0.42, 0.018, '#464d50', x, 0.03, at(54.8), 0, 0, 0, 20);
      parts.cylinder(0.34, 0.34, 0.022, '#687072', x, 0.031, at(54.8), 0, 0, 0, 20);
    }
    // Стопки легкоатлетических барьеров между дорожкой и ограждением.
    for (const centre of [-31 + shift, 3.5 + shift, 27 - shift]) {
      for (let n = 0; n < 6; n += 1) {
        const depth = 47.15 + n * 0.27;
        for (const dx of [-0.56, 0.56]) {
          parts.box(0.06, 0.04, 0.55, '#8f999e', centre + dx, 0.06, at(depth + 0.2));
          parts.rod([centre + dx, 0.06, at(depth)], [centre + dx, 0.95, at(depth)], 0.018, '#c3cacd');
        }
        parts.box(1.2, 0.08, 0.03, '#f2f2ec', centre, 0.97, at(depth));
        for (const dx of [-0.42, 0, 0.42]) parts.box(0.2, 0.084, 0.034, '#1c1f21', centre + dx, 0.97, at(depth));
      }
    }
    // Телекамеры на штативах у углов поля (в середине они загораживали бы вид с мест), объектив в сторону поля.
    for (const x of [-39, 39]) {
      for (const [dx, dz] of [[-0.42, 0.28], [0.42, 0.28], [0, -0.48]]) parts.rod([x + dx, 0.05, at(48.6 + dz)], [x, 1.28, at(48.6)], 0.022, '#2b3033');
      parts.box(0.3, 0.34, 0.62, '#1b1f22', x, 1.48, at(48.6));
      parts.cylinder(0.1, 0.13, 0.34, '#0e1011', x, 1.48, at(48.6 - 0.46), Math.PI / 2);
      parts.box(0.14, 0.13, 0.24, '#40474b', x + 0.22, 1.68, at(48.75));
    }
    // Кофры оборудования с металлической кромкой.
    for (const [x, turn] of [[-16.4 + shift, 0.2], [-15.4 + shift, -0.35], [21 + shift, 0.5], [-35 + shift, -0.1]]) {
      parts.box(0.8, 0.46, 0.5, '#20262a', x, 0.27, at(51.6), 0, turn);
      parts.box(0.83, 0.035, 0.53, '#aab2b5', x, 0.5, at(51.6), 0, turn);
      parts.box(0.83, 0.035, 0.53, '#aab2b5', x, 0.06, at(51.6), 0, turn);
    }
    // Урны вдоль барьера: невысокие и вплотную к нему, чтобы не спорить с полем.
    for (let x = -41 + shift; x <= 36; x += 18) {
      parts.cylinder(0.21, 0.18, 0.74, '#6b8276', x, 0.41, at(farZ - 0.4), 0, 0, 0, 14);
      parts.cylinder(0.23, 0.23, 0.05, '#8e9d96', x, 0.8, at(farZ - 0.4), 0, 0, 0, 14);
    }
  }
  // Секторы внутри виражей за воротами: маты, яма с песком и разбег, люки.
  for (const side of [-1, 1]) {
    const at = (x) => side * x;
    const mirror = side * 8; // стороны повёрнуты друг к другу, а не повторяют одна другую
    parts.box(3.4, 0.62, 5.2, '#2456a6', at(71.5), 0.34, -mirror - side * 1.5);
    parts.box(3.5, 0.08, 5.3, '#173c78', at(71.5), 0.69, -mirror - side * 1.5);
    parts.box(3.2, 0.05, 9.4, '#e8e9e2', at(70.5), 0.035, mirror + side * 3);
    parts.box(2.9, 0.06, 9.1, '#c4ad7c', at(70.5), 0.04, mirror + side * 3);
    parts.box(1.3, 0.025, 15, '#486075', at(70.5), 0.036, mirror - side * 9.5);
    parts.box(1.3, 0.032, 0.2, '#f2f2ec', at(70.5), 0.037, mirror - side * 3.2);
    for (const z of [-16, -2, 15]) {
      parts.box(0.92, 0.018, 0.92, '#4a5154', at(73), 0.03, z);
      parts.box(0.78, 0.022, 0.78, '#70787a', at(73), 0.031, z);
    }
  }
  scene.add(parts.mesh(0.7, 0.15));
}
