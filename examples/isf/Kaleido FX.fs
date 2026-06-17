/*{
  "DESCRIPTION": "Kaleido FX",
  "CATEGORIES": ["Filter", "Geometry"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "segments", "TYPE": "float", "MIN": 2.0, "MAX": 24.0, "DEFAULT": 6.0 },
    { "NAME": "rotation", "TYPE": "float", "MIN": 0.0, "MAX": 6.2831853, "DEFAULT": 0.0 },
    { "NAME": "spin", "TYPE": "float", "MIN": -2.0, "MAX": 2.0, "DEFAULT": 0.0 },
    { "NAME": "zoom", "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0 }
  ]
}*/

void main() {
  // Aspect-corrected centered coords.
  vec2 p = isf_FragNormCoord - 0.5;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  p.x *= aspect;

  float r = length(p);
  float a = atan(p.y, p.x);

  // Wedge angle for N mirrored segments.
  float seg = 6.2831853 / max(segments, 1.0);

  a += rotation + TIME * spin;

  // Fold the angle into a single mirrored wedge.
  a = mod(a, seg);
  a = abs(a - seg * 0.5);

  // Reconstruct sample coords, un-correct aspect, recentre.
  r /= zoom;
  vec2 sp = vec2(cos(a), sin(a)) * r;
  sp.x /= aspect;
  vec2 uv = sp + 0.5;

  // Mirror-wrap into 0..1 so the kaleidoscope tiles seamlessly.
  uv = abs(fract(uv * 0.5) * 2.0 - 1.0);

  gl_FragColor = IMG_NORM_PIXEL(inputImage, uv);
}
