/*{
  "DESCRIPTION": "Plasma",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 0.6 },
    { "NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 20.0, "DEFAULT": 6.0 },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [0.2, 0.6, 1.0, 1.0] }
  ]
}*/
void main() {
  vec2 p = isf_FragNormCoord * scale;
  float t = TIME * speed;
  float v = sin(p.x + t) + sin(p.y + t) + sin(p.x + p.y + t) + sin(length(p) - t);
  v = 0.5 + 0.25 * v;
  gl_FragColor = vec4(tint.rgb * v, 1.0);
}
