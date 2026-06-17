/*{
  "DESCRIPTION": "Ink Clouds",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.3 },
    { "NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 2.5 },
    { "NAME": "warp", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.6 },
    { "NAME": "ink", "TYPE": "color", "DEFAULT": [0.15, 0.05, 0.4, 1.0] },
    { "NAME": "bloom", "TYPE": "color", "DEFAULT": [0.95, 0.55, 0.85, 1.0] }
  ]
}*/

// ink dropped in water: deep domain-warped fbm billowing slowly

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.5);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    v += amp * vnoise(p);
    p = p * 2.03 + vec2(0.7, -0.3);
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  uv.x *= RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = uv * scale;

  float t = TIME * speed;

  // two-stage domain warp for billowing, cloud-like motion
  vec2 q = vec2(fbm(p + t * 0.1), fbm(p + vec2(5.2, 1.3) - t * 0.12));
  vec2 r = vec2(
    fbm(p + warp * q + vec2(1.7, 9.2) + t * 0.15),
    fbm(p + warp * q + vec2(8.3, 2.8) - t * 0.13)
  );
  float f = fbm(p + warp * r);

  f = clamp(f * 1.3, 0.0, 1.0);

  // layered tones: dark ink core -> bloom edges -> bright tendrils
  vec3 col = mix(vec3(0.02, 0.0, 0.06), ink.rgb, smoothstep(0.0, 0.5, f));
  col = mix(col, bloom.rgb, smoothstep(0.45, 0.85, f));
  col += bloom.rgb * pow(smoothstep(0.6, 1.0, length(r)), 3.0) * 0.4;

  gl_FragColor = vec4(col, 1.0);
}
