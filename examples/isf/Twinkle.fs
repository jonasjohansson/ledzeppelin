/*{
  "DESCRIPTION": "Twinkle",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "density", "TYPE": "float", "MIN": 4.0, "MAX": 80.0, "DEFAULT": 28.0 },
    { "NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 6.0, "DEFAULT": 1.5 },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
    { "NAME": "size", "TYPE": "float", "MIN": 0.05, "MAX": 1.0, "DEFAULT": 0.45 },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0] }
  ]
}*/

// random stars fading in and out across a strip or matrix

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  uv.x *= RENDERSIZE.x / RENDERSIZE.y;

  // cell grid; each cell can host one star
  vec2 grid = uv * density;
  vec2 cell = floor(grid);
  vec2 f = fract(grid) - 0.5;

  float rnd = hash(cell);
  // only `amount` fraction of cells ever light up
  float active = step(1.0 - amount, rnd);

  // each star blinks on its own phase and rate
  float phase = hash(cell + 7.0) * 6.2832;
  float rate = 0.5 + hash(cell + 13.0) * 1.5;
  float twinkle = 0.5 + 0.5 * sin(TIME * speed * rate + phase);
  twinkle = pow(twinkle, 4.0);

  // jittered position inside the cell + soft point falloff
  vec2 offset = (vec2(hash(cell + 3.0), hash(cell + 5.0)) - 0.5) * 0.6;
  float d = length(f - offset);
  float star = smoothstep(size * 0.5, 0.0, d);

  float v = active * twinkle * star;
  gl_FragColor = vec4(tint.rgb * v, 1.0);
}
