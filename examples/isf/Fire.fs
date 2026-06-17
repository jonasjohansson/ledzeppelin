/*{
  "DESCRIPTION": "Fire",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 1.6 },
    { "NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 3.0 },
    { "NAME": "height", "TYPE": "float", "MIN": 0.2, "MAX": 1.5, "DEFAULT": 0.85 },
    { "NAME": "intensity", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.1 },
    { "NAME": "ember", "TYPE": "color", "DEFAULT": [1.0, 0.18, 0.0, 1.0] },
    { "NAME": "flame", "TYPE": "color", "DEFAULT": [1.0, 0.75, 0.15, 1.0] }
  ]
}*/

// warm bottom-up gradient with fbm flames licking upward

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

void main() {
  vec2 uv = isf_FragNormCoord;
  float t = TIME * speed;

  // flames rise: scroll noise downward over time
  vec2 q = vec2(uv.x * scale, uv.y * scale * 1.6 - t);
  float n = fbm(q + fbm(q * 0.5 + vec2(0.0, t * 0.5)) * 0.6);

  // taper the fire so it dies out toward the top
  float falloff = 1.0 - smoothstep(0.0, height, uv.y);
  float fire = n * falloff * 1.8 * intensity;

  // build colour ramp: black -> ember -> flame -> white-hot
  vec3 col = vec3(0.0);
  col = mix(col, ember.rgb, smoothstep(0.15, 0.55, fire));
  col = mix(col, flame.rgb, smoothstep(0.55, 0.95, fire));
  col = mix(col, vec3(1.0), smoothstep(1.0, 1.4, fire));

  gl_FragColor = vec4(col, 1.0);
}
