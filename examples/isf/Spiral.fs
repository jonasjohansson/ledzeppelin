/*{
  "DESCRIPTION": "Spiral",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "arms", "TYPE": "float", "MIN": 1.0, "MAX": 12.0, "DEFAULT": 4.0 },
    { "NAME": "twist", "TYPE": "float", "MIN": 0.0, "MAX": 20.0, "DEFAULT": 8.0 },
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 1.5 },
    { "NAME": "colorA", "TYPE": "color", "DEFAULT": [0.9, 0.1, 0.1, 1.0] },
    { "NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 0.9, 0.0, 1.0] }
  ]
}*/

const float TAU = 6.28318530718;

void main() {
  vec2 p = isf_FragNormCoord - 0.5;
  p.x *= RENDERSIZE.x / RENDERSIZE.y;

  float t = TIME * speed;
  float r = length(p);
  float a = atan(p.y, p.x);

  // logarithmic spiral phase: angle wound with radius
  float phase = a * arms + log(r + 0.02) * twist + t * 3.0;
  float s = sin(phase);

  // crisp hypnotic black/color stripes
  float stripe = smoothstep(-0.15, 0.15, s);

  vec3 col = mix(colorA.rgb, colorB.rgb, stripe);
  // radial brightness wave pulsing outward
  float pulse = 0.5 + 0.5 * sin(r * 14.0 - t * 4.0);
  col *= 0.45 + 0.8 * pulse;
  // hot core
  col += colorB.rgb * (0.18 / (r * 5.0 + 0.25));
  // edge fade
  col *= smoothstep(0.95, 0.2, r) + 0.15;

  gl_FragColor = vec4(col, 1.0);
}
