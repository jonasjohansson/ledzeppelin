/*{
  "DESCRIPTION": "Halftone",
  "CATEGORIES": ["Filter", "Stylize"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "scale", "TYPE": "float", "MIN": 4.0, "MAX": 200.0, "DEFAULT": 60.0 },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 3.1415927, "DEFAULT": 0.3926991 },
    { "NAME": "invert", "TYPE": "bool", "DEFAULT": false },
    { "NAME": "tint", "TYPE": "bool", "DEFAULT": false },
    { "NAME": "ink", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0] },
    { "NAME": "paper", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0] }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;

  // Aspect-corrected pixel-space coords so dots stay round.
  vec2 p = uv;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  p.x *= aspect;

  // Rotate the screen grid.
  float cs = cos(angle);
  float sn = sin(angle);
  mat2 rot = mat2(cs, -sn, sn, cs);
  vec2 rp = rot * p * scale;

  // Distance to nearest dot centre within the rotated grid cell.
  vec2 cell = fract(rp) - 0.5;
  float d = length(cell);

  // Sample source luminance at this fragment.
  vec4 src = IMG_NORM_PIXEL(inputImage, uv);
  float luma = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  if (invert) luma = 1.0 - luma;

  // Dot radius grows as the area gets darker (luma low -> bigger ink dot).
  float radius = sqrt(clamp(1.0 - luma, 0.0, 1.0)) * 0.72;

  // Antialiased dot coverage (1 = ink, 0 = paper).
  float aa = fwidth(d) + 0.001;
  float coverage = 1.0 - smoothstep(radius - aa, radius + aa, d);

  vec3 inkCol = tint ? src.rgb : ink.rgb;
  vec3 outc = mix(paper.rgb, inkCol, coverage);

  gl_FragColor = vec4(outc, src.a);
}
