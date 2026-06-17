/*{
  "DESCRIPTION": "Aurora",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5 },
    { "NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 2.5 },
    { "NAME": "curtains", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 3.0 },
    { "NAME": "green", "TYPE": "color", "DEFAULT": [0.1, 1.0, 0.5, 1.0] },
    { "NAME": "violet", "TYPE": "color", "DEFAULT": [0.5, 0.1, 0.9, 1.0] }
  ]
}*/

// flowing aurora curtains: wavy noise bands rising on a night sky

float hash(vec2 p) {
  p = fract(p * vec2(91.34, 67.21));
  p += dot(p, p + 23.7);
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
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p *= 2.05;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float t = TIME * speed;

  vec3 col = vec3(0.0);

  // a few overlapping curtains, each waving horizontally and shifting hue
  for (int i = 0; i < 6; i++) {
    if (float(i) >= curtains) break;
    float fi = float(i);
    float off = fi * 0.37;

    // horizontal wobble of the curtain centre line
    float wob = fbm(vec2(uv.x * aspect * scale + t * 0.6 + off * 3.0, fi * 1.7));
    float centre = 0.35 + 0.45 * (fi / max(curtains - 1.0, 1.0));
    centre += (wob - 0.5) * 0.35;

    // vertical band falloff -> soft curtain
    float band = exp(-pow((uv.y - centre) * (4.0 + 3.0 * wob), 2.0));

    // fine vertical striations that drift
    float stri = fbm(vec2(uv.x * aspect * scale * 3.0 + off * 5.0, t * 1.5 + off));
    band *= 0.6 + 0.7 * stri;

    vec3 hue = mix(green.rgb, violet.rgb, fract(off + wob * 0.5 + t * 0.05));
    col += hue * band;
  }

  // subtle star/sky floor
  col += vec3(0.02, 0.03, 0.06) * (1.0 - uv.y);
  col = col / (1.0 + col); // soft tonemap so LEDs don't clip harshly
  col = pow(col, vec3(0.85));

  gl_FragColor = vec4(col, 1.0);
}
