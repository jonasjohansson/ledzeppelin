/*{
  "DESCRIPTION": "Curl Flow",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.4 },
    { "NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 3.0 },
    { "NAME": "swirl", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0 },
    { "NAME": "colorA", "TYPE": "color", "DEFAULT": [0.1, 0.7, 0.9, 1.0] },
    { "NAME": "colorB", "TYPE": "color", "DEFAULT": [0.95, 0.2, 0.6, 1.0] }
  ]
}*/

// domain-warped fbm advected along a curl-noise flow field

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
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
  for (int i = 0; i < 5; i++) {
    v += amp * vnoise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return v;
}

// curl of a scalar potential -> divergence-free swirling flow
vec2 curl(vec2 p) {
  float e = 0.1;
  float n1 = fbm(p + vec2(0.0, e));
  float n2 = fbm(p - vec2(0.0, e));
  float n3 = fbm(p + vec2(e, 0.0));
  float n4 = fbm(p - vec2(e, 0.0));
  return vec2(n1 - n2, n4 - n3) / (2.0 * e);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  uv.x *= RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = uv * scale;

  float t = TIME * speed;
  // advect the sample point along the flow over a few steps
  for (int i = 0; i < 4; i++) {
    vec2 v = curl(p + t * 0.2);
    p += v * swirl * 0.18;
  }

  float n = fbm(p + t * 0.1);
  n = fbm(p + vec2(n) + t * 0.15);
  n = clamp(n * 1.4, 0.0, 1.0);

  vec3 col = mix(colorA.rgb, colorB.rgb, smoothstep(0.25, 0.75, n));
  // bright filaments where flow folds
  col += vec3(1.0) * pow(n, 4.0) * 0.5;
  col *= 0.4 + 0.8 * n;

  gl_FragColor = vec4(col, 1.0);
}
