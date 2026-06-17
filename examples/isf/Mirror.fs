/*{
  "DESCRIPTION": "Mirror",
  "CATEGORIES": ["Filter", "Geometry"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    {
      "NAME": "mode",
      "TYPE": "long",
      "DEFAULT": 0,
      "VALUES": [0, 1, 2, 3],
      "LABELS": ["Horizontal", "Vertical", "Quad", "Diagonal"]
    },
    { "NAME": "flip", "TYPE": "bool", "DEFAULT": false }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;

  if (mode == 0) {
    // Horizontal: mirror left half onto right.
    uv.x = (uv.x < 0.5) ? uv.x : 1.0 - uv.x;
    uv.x *= 2.0;
  } else if (mode == 1) {
    // Vertical: mirror bottom half onto top.
    uv.y = (uv.y < 0.5) ? uv.y : 1.0 - uv.y;
    uv.y *= 2.0;
  } else if (mode == 2) {
    // Quad: four-way symmetry.
    uv.x = (uv.x < 0.5) ? uv.x : 1.0 - uv.x;
    uv.y = (uv.y < 0.5) ? uv.y : 1.0 - uv.y;
    uv *= 2.0;
  } else {
    // Diagonal: fold across the main diagonal.
    if (uv.x + uv.y > 1.0) {
      uv = 1.0 - uv.yx;
    } else {
      uv = uv.xy;
    }
  }

  if (flip) {
    uv = 1.0 - uv;
  }

  uv = clamp(uv, 0.0, 1.0);
  gl_FragColor = IMG_NORM_PIXEL(inputImage, uv);
}
