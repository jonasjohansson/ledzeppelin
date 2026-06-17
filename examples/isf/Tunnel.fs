/*{
  "DESCRIPTION": "Tunnel",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 1.2 },
    { "NAME": "rings", "TYPE": "float", "MIN": 2.0, "MAX": 30.0, "DEFAULT": 10.0 },
    { "NAME": "twist", "TYPE": "float", "MIN": 0.0, "MAX": 8.0, "DEFAULT": 2.0 },
    { "NAME": "colorA", "TYPE": "color", "DEFAULT": [0.05, 0.0, 0.3, 1.0] },
    { "NAME": "colorB", "TYPE": "color", "DEFAULT": [1.0, 0.7, 0.1, 1.0] }
  ]
}*/

const float TAU = 6.28318530718;

void main() {
  vec2 p = isf_FragNormCoord - 0.5;
  p.x *= RENDERSIZE.x / RENDERSIZE.y;

  float t = TIME * speed;
  float r = length(p);
  float a = atan(p.y, p.x);

  // infinite tunnel: depth scrolls as 1/r
  float depth = 0.3 / (r + 0.05) + t;
  // angular spin that increases toward the throat (twist)
  float ang = a / TAU + twist * r * 0.5 + t * 0.1;

  // checker-ish tunnel walls
  float wall = sin(depth * rings) * sin(ang * 8.0);
  float band = 0.5 + 0.5 * sin(depth * rings * TAU * 0.5);

  vec3 col = mix(colorA.rgb, colorB.rgb, 0.5 + 0.5 * wall);
  col *= 0.3 + 0.9 * band;

  // dark vignette toward edges, bright at the vanishing point
  col *= smoothstep(0.9, 0.1, r);
  col += colorB.rgb * (0.2 / (r * 6.0 + 0.3));

  gl_FragColor = vec4(col, 1.0);
}
