/*{
  "DESCRIPTION": "Caustics",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5 },
    { "NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 12.0, "DEFAULT": 5.0 },
    { "NAME": "sharpness", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 4.0 },
    { "NAME": "water", "TYPE": "color", "DEFAULT": [0.0, 0.5, 0.85, 1.0] },
    { "NAME": "glint", "TYPE": "color", "DEFAULT": [0.7, 1.0, 0.9, 1.0] }
  ]
}*/

// underwater caustic web via iterated folded sine field

void main() {
  vec2 uv = isf_FragNormCoord;
  uv.x *= RENDERSIZE.x / RENDERSIZE.y;
  vec2 p = uv * scale;

  float t = TIME * speed;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.0045;

  // classic caustic loop: repeatedly warp and accumulate light
  for (int n = 0; n < 5; n++) {
    float fn = float(n) + 1.0;
    float ti = t * (1.0 - (3.5 / fn));
    i = p + vec2(
      cos(ti - i.x) + sin(ti + i.y),
      sin(ti - i.y) + cos(ti + i.x)
    );
    vec2 d = p / vec2(
      sin(i.x + ti) / inten,
      cos(i.y + ti) / inten
    );
    c += 1.0 / length(d);
  }

  c /= 5.0;
  c = pow(clamp(c, 0.0, 1.0), sharpness);

  vec3 col = mix(water.rgb * 0.25, water.rgb, c);
  col += glint.rgb * pow(c, 2.0) * 1.2;

  gl_FragColor = vec4(col, 1.0);
}
