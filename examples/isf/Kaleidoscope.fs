/*{
  "DESCRIPTION": "Kaleidoscope",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "sides", "TYPE": "float", "MIN": 2.0, "MAX": 16.0, "DEFAULT": 6.0 },
    { "NAME": "zoom", "TYPE": "float", "MIN": 1.0, "MAX": 12.0, "DEFAULT": 4.0 },
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 0.5 },
    { "NAME": "colorA", "TYPE": "color", "DEFAULT": [1.0, 0.15, 0.5, 1.0] },
    { "NAME": "colorB", "TYPE": "color", "DEFAULT": [0.1, 0.8, 1.0, 1.0] }
  ]
}*/

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

void main() {
  vec2 p = isf_FragNormCoord - 0.5;
  p.x *= RENDERSIZE.x / RENDERSIZE.y;

  float t = TIME * speed;

  // polar coords, mirror into a wedge for kaleidoscope symmetry
  float a = atan(p.y, p.x);
  float r = length(p);
  float seg = TAU / sides;
  a = mod(a + t, seg);
  a = abs(a - seg * 0.5);

  vec2 q = vec2(cos(a), sin(a)) * r * zoom;
  q += t * 0.5;

  // layered rings + cells
  float pattern = sin(q.x * 3.0) * sin(q.y * 3.0);
  pattern += 0.6 * sin(r * zoom * 4.0 - t * 3.0);
  pattern = 0.5 + 0.5 * sin(pattern * PI + t);

  vec3 col = mix(colorA.rgb, colorB.rgb, pattern);
  // bright crisp bands that pop on LEDs
  float bands = smoothstep(0.35, 0.5, abs(fract(pattern * 3.0) - 0.5));
  col *= 0.4 + 0.9 * bands;
  // center glow
  col += colorB.rgb * (0.15 / (r * zoom + 0.2));

  gl_FragColor = vec4(col, 1.0);
}
