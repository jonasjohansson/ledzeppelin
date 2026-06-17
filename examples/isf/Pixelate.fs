/*{
  "DESCRIPTION": "Pixelate",
  "CATEGORIES": ["Filter", "Stylize"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "size", "TYPE": "float", "MIN": 1.0, "MAX": 128.0, "DEFAULT": 16.0 },
    { "NAME": "aspectLock", "TYPE": "bool", "DEFAULT": true },
    { "NAME": "gap", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;

  // Grid resolution in cells across the image.
  float cellsX = max(size, 1.0);
  float cellsY = cellsX;
  if (!aspectLock) {
    // Match cell pixel size to the actual aspect (rectangular cells -> square px).
    cellsY = cellsX * (RENDERSIZE.y / RENDERSIZE.x);
  }
  vec2 cells = vec2(cellsX, cellsY);

  // Snap to the centre of each grid cell.
  vec2 cell = floor(uv * cells);
  vec2 local = fract(uv * cells);
  vec2 snapped = (cell + 0.5) / cells;

  vec4 col = IMG_NORM_PIXEL(inputImage, snapped);

  // Optional gap (mortar) between blocks for a tile/LED look.
  if (gap > 0.0) {
    vec2 edge = min(local, 1.0 - local);
    float m = step(gap * 0.5, min(edge.x, edge.y));
    col.rgb *= m;
  }

  gl_FragColor = col;
}
