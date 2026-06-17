/*{
  "DESCRIPTION": "RGB Shift",
  "CATEGORIES": ["Filter"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 0.1, "DEFAULT": 0.02 }
  ]
}*/
void main() {
  vec2 uv = isf_FragNormCoord;
  float r = IMG_NORM_PIXEL(inputImage, uv + vec2(amount, 0.0)).r;
  float g = IMG_THIS_PIXEL(inputImage).g;
  float b = IMG_NORM_PIXEL(inputImage, uv - vec2(amount, 0.0)).b;
  gl_FragColor = vec4(r, g, b, 1.0);
}
