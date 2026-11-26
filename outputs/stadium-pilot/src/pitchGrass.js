// Газон в шейдере: полосы покоса, которые меняют яркость вместе с углом взгляда, неоднородность травы,
// потёртости и разметка без «пунктира» на дальних линиях. Без новых текстур. Вызывать после weather():
// использует vWeatherPos и wNoise. Размеры поля 105 × 68 м, разметка по правилам футбола.

const DECLARATIONS = `
// Доля пикселя, накрытая отрезком [lo, hi] по одной оси.
float pitchSpan(float v, float lo, float hi, float w) { return clamp((v - lo) / w + 0.5, 0.0, 1.0) - clamp((v - hi) / w + 0.5, 0.0, 1.0); }
// Линия на расстоянии d от оси: совсем тонкие вдали чуть расширяются, чтобы не пропадать.
float pitchStroke(float d, float w) { float half_ = max(0.07, w * 0.28); return pitchSpan(d, -half_, half_, w); }
float pitchRect(vec2 p, vec2 lo, vec2 hi, vec2 w) { return pitchSpan(p.x, lo.x, hi.x, w.x) * pitchSpan(p.y, lo.y, hi.y, w.y); }
// Прямые линии: p уже сложено в одну четверть поля.
float pitchAlongX(vec2 p, float z, float from, float to, vec2 w) { float half_ = max(0.07, w.y * 0.28); return pitchRect(p, vec2(from - 0.07, z - half_), vec2(to + 0.07, z + half_), w); }
float pitchAlongZ(vec2 p, float x, float from, float to, vec2 w) { float half_ = max(0.07, w.x * 0.28); return pitchRect(p, vec2(x - half_, from - 0.07), vec2(x + half_, to + 0.07), w); }
float pitchArc(vec2 offset, float radius) { float r = length(offset); return pitchStroke(r - radius, max(fwidth(r), 0.001)); }
float pitchMarkings(vec2 place) {
  vec2 w = max(fwidth(place), vec2(0.001));
  vec2 p = abs(place);
  float m = pitchAlongX(p, 34.0, 0.0, 52.5, w);
  m = max(m, pitchAlongZ(p, 52.5, 0.0, 34.0, w));
  m = max(m, pitchAlongZ(p, 0.0, -1.0, 34.0, w));
  m = max(m, pitchAlongZ(p, 36.0, 0.0, 20.16, w));
  m = max(m, pitchAlongX(p, 20.16, 36.0, 52.5, w));
  m = max(m, pitchAlongZ(p, 47.0, 0.0, 9.16, w));
  m = max(m, pitchAlongX(p, 9.16, 47.0, 52.5, w));
  m = max(m, pitchArc(place, 9.15));
  vec2 spot = p - vec2(41.5, 0.0);
  m = max(m, pitchArc(spot, 9.15) * clamp((36.0 - p.x) / w.x + 0.5, 0.0, 1.0));
  vec2 corner = p - vec2(52.5, 34.0);
  m = max(m, pitchArc(corner, 1.0) * clamp(-corner.x / w.x + 0.5, 0.0, 1.0) * clamp(-corner.y / w.y + 0.5, 0.0, 1.0));
  float dots = min(length(spot), length(place));
  m = max(m, clamp((0.17 - dots) / max(fwidth(dots), 0.001) + 0.5, 0.0, 1.0));
  return m;
}
`;

const SURFACE = `
{
  vec2 place = vWeatherPos.xz;
  vec2 width = max(fwidth(place), vec2(0.001));
  vec3 toEye = normalize(cameraPosition - vWeatherPos);
  // Покос: полосы по 5,25 м и слабый поперечный рисунок. Трава, наклонённая от зрителя, светлее, к зрителю темнее.
  // Если полоса становится уже двух пикселей, рисунок плавно исчезает вместо ряби.
  vec2 wave = sin(vec2(place.x / 5.25, place.y / 6.8) * 3.14159265);
  vec2 sharp = clamp(wave / max(width * 0.75, vec2(0.04)), -1.0, 1.0) * (1.0 - smoothstep(vec2(1.2), vec2(2.8), width));
  float mow = sharp.x * (0.13 - 0.065 * toEye.x) + sharp.y * (0.045 - 0.035 * toEye.z);
  // Неоднородность: крупные пятна, участки с желтизной и зерно, заметное только вблизи.
  float broad = wNoise(vec3(place * 0.07, 3.0)) * 0.6 + wNoise(vec3(place * 0.23, 8.0)) * 0.4;
  float clump = wNoise(vec3(place * 1.15, 1.0));
  float grain = wNoise(vec3(place * 5.3, 5.0));
  float fine = 1.0 - smoothstep(0.08, 0.35, max(width.x, width.y));
  float medium = 1.0 - smoothstep(0.35, 1.4, max(width.x, width.y));
  diffuseColor.rgb *= 1.0 + mow + (broad - 0.5) * 0.2 + (clump - 0.5) * 0.2 * medium + (grain - 0.5) * 0.34 * fine;
  diffuseColor.rgb *= mix(vec3(1.0), vec3(1.12, 1.03, 0.78), smoothstep(0.55, 0.85, wNoise(vec3(place * 0.11, 21.0))));
  // Потёртости: вратарские площадки, точки пенальти и центр, рваные по краям.
  vec2 folded = vec2(abs(place.x), place.y);
  float wear = max(1.0 - length((folded - vec2(49.6, 0.0)) / vec2(4.2, 7.5)), 0.0) * 1.5;
  wear = max(wear, max(1.0 - length((folded - vec2(41.5, 0.0)) / vec2(2.6, 2.6)), 0.0));
  wear = max(wear, max(1.0 - length(place / vec2(7.0, 7.0)), 0.0) * 0.6);
  wear *= smoothstep(0.2, 0.75, wNoise(vec3(place * 0.8, 13.0)) * 0.7 + clump * 0.3);
  float luma = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.25, 1.0, 0.62) * luma * 0.9, clamp(wear, 0.0, 0.75));
  // Под скользящим углом трава отражает небо и выглядит чуть бледнее.
  float grazing = pow(1.0 - clamp(toEye.y, 0.0, 1.0), 5.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.08 + vec3(0.012, 0.016, 0.02), grazing);
  // Краска разметки лежит на траве: сохраняет часть её зерна.
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.77, 0.7) * (0.9 + 0.2 * mix(0.5, grain, fine)), pitchMarkings(place) * 0.95);
}
`;

export function patchPitchGrass(material) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${DECLARATIONS}\nvoid main() {`)
      .replace('#include <alphamap_fragment>', `${SURFACE}#include <alphamap_fragment>`);
  };
  material.customProgramCacheKey = () => 'pitch-grass';
  material.needsUpdate = true;
}
