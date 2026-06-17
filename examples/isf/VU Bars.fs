/*{
  "DESCRIPTION": "VU Bars",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "bars", "TYPE": "float", "MIN": 2.0, "MAX": 32.0, "DEFAULT": 12.0 },
    { "NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 6.0, "DEFAULT": 2.0 },
    { "NAME": "gap", "TYPE": "float", "MIN": 0.0, "MAX": 0.4, "DEFAULT": 0.12 },
    { "NAME": "peak", "TYPE": "bool", "DEFAULT": true },
    { "NAME": "low", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.1, 1.0] },
    { "NAME": "high", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.0, 1.0] }
  ]
}*/

// animated vertical bars with green->red height ramp

float hash(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

void main() {
  vec2 uv = isf_FragNormCoord;

  // which bar are we in
  float bx = uv.x * bars;
  float idx = floor(bx);
  float frac = fract(bx);

  // animated height per bar: layered sines for a lively meter
  float seed = hash(idx) * 6.2832;
  float t = TIME * speed;
  float h = 0.5
    + 0.30 * sin(t * (1.0 + hash(idx + 1.0)) + seed)
    + 0.18 * sin(t * (2.3 + hash(idx + 2.0) * 2.0) + seed * 1.7);
  h = clamp(h, 0.03, 1.0);

  // bar body with a horizontal gap between bars
  float inBar = step(gap * 0.5, frac) * step(frac, 1.0 - gap * 0.5);
  float lit = inBar * step(uv.y, h);

  // colour ramps by vertical position: green at base -> red at top
  vec3 col = mix(low.rgb, high.rgb, uv.y) * lit;

  // bright peak cap that floats at the bar top
  if (peak) {
    float cap = smoothstep(0.04, 0.0, abs(uv.y - h)) * inBar;
    col += mix(low.rgb, high.rgb, h) * cap * 1.2;
  }

  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
