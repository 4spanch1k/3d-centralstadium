// Дальние трибуны: разный тон кресел, читаемые ряды и лёгкая воздушная дымка.
// Всё считается в шейдере без новых текстур и геометрии. Вызывать после weather(): использует uLightAmount.

// Дымка действует только с низкой камеры (вид с места и сектора); общий вид сверху и вечер не меняются.
const HAZE = `float lowCamera = 1.0 - smoothstep(30.0, 60.0, cameraPosition.y);
  float haze = smoothstep(50.0, 220.0, length(vViewPosition)) * 0.12 * lowCamera * (1.0 - clamp(uLightAmount, 0.0, 1.0));
  outgoingLight = mix(outgoingLight, vec3(0.36, 0.46, 0.62), haze);
`;

function extend(material, key, edit) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    edit(shader);
  };
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
}

function addHaze(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `{
  ${HAZE}}
#include <opaque_fragment>`);
}

export function patchStandConcrete(material) {
  extend(material, 'stand-concrete', addHaze);
}

// Материал кресел (только InstancedMesh): тон зависит от положения места, поэтому одинаков на всех уровнях детализации
// и не сбивается подсветкой выбора (она меняет цвет экземпляра).
export function patchStandSeat(material) {
  extend(material, 'stand-seat', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying float vSeatHeight;
varying vec2 vSeatTone;
float standHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float standNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(standHash(i), standHash(i + vec2(1.0, 0.0)), f.x), mix(standHash(i + vec2(0.0, 1.0)), standHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSeatHeight = position.y;
#ifdef USE_INSTANCING
{
  vec3 origin = instanceMatrix[3].xyz;
  float single = standHash(origin.xz * 3.7 + origin.y);
  float row = standHash(vec2(floor(origin.y * 2.7 + 0.5), 7.0));
  // Крупные пятна по 8–25 м: партии кресел разной свежести и выгоревшие участки.
  float zone = standNoise(origin.xz * 0.12 + origin.y * 0.31) * 0.65 + standNoise(origin.xz * 0.045 + 19.0) * 0.35;
  float bright = (0.86 + 0.26 * single) * (0.93 + 0.14 * row) * (0.86 + 0.42 * zone);
  float fade = clamp((zone - 0.52) * 0.8, 0.0, 0.22) + step(0.94, standHash(origin.zx * 5.3)) * 0.2;
  vSeatTone = vec2(bright, fade);
}
#else
vSeatTone = vec2(1.0, 0.0);
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSeatHeight;\nvarying vec2 vSeatTone;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // Издали ряды сливаются в одну стену: низ спинки темнее, верхняя кромка ловит небо. Вблизи этого нет.
  float distant = smoothstep(22.0, 60.0, length(vViewPosition)) * (1.0 - smoothstep(30.0, 60.0, cameraPosition.y));
  // Выгоревший пластик светлее и бледнее, но своего цвета не теряет; вблизи разница вдвое слабее.
  float luma = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
  vec3 faded = mix(diffuseColor.rgb, vec3(luma), 0.45) * 1.45 + 0.025;
  diffuseColor.rgb = mix(diffuseColor.rgb, faded, vSeatTone.y * mix(0.5, 1.0, distant)) * mix(1.0, vSeatTone.x, mix(0.65, 1.0, distant));
  float height = smoothstep(0.06, 0.5, vSeatHeight);
  diffuseColor.rgb *= mix(1.0, mix(0.66, 1.62, height * height), distant);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.46, 0.52, 0.56), smoothstep(0.43, 0.52, vSeatHeight) * distant * 0.2);
}`);
    addHaze(shader);
  });
}
