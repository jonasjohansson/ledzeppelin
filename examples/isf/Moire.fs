/*{
  "DESCRIPTION": "Moire",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "freq", "TYPE": "float", "MIN": 4.0, "MAX": 60.0, "DEFAULT": 24.0 },
    { "NAME": "offset", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.18 },
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 0.7 },
    { "NAME": "colorA", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.6, 1.0] },
    { "NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 0.0, 0.8, 1.0] }
  ]
}*/

void main() {
  vec2 p = isf_FragNormCoord - 0.5;
  p.x *= RENDERSIZE.x / RENDERSIZE.y;

  float t = TIME * speed;

  // two radial ripple sources drifting apart -> moire interference
  vec2 c1 = vec2(sin(t) * offset, cos(t * 0.7) * offset);
  vec2 c2 = vec2(-sin(t * 1.3) * offset, -cos(t) * offset);

  float w1 = sin(length(p - c1) * freq - t * 4.0);
  float w2 = sin(length(p - c2) * freq + t * 3.0);

  // interference product creates the beat pattern
  float m = w1 * w2;
  float bands = step(0.0, m);

  vec3 col = mix(colorA.rgb, colorB.rgb, bands);
  // high-contrast edges between fringes for crisp LED look
  float edge = abs(m);
  col *= 0.5 + 0.7 * smoothstep(0.0, 0.25, edge);

  gl_FragColor = vec4(col, 1.0);
}
