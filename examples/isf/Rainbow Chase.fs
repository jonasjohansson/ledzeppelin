/*{
  "DESCRIPTION": "Rainbow Chase",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "MIN": -4.0, "MAX": 4.0, "DEFAULT": 0.6 },
    { "NAME": "bands", "TYPE": "float", "MIN": 1.0, "MAX": 12.0, "DEFAULT": 3.0 },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0 },
    { "NAME": "saturation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 },
    { "NAME": "brightness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 }
  ]
}*/

// hue scrolling along a settable axis, repeated `bands` times

vec3 hue2rgb(float h) {
  h = fract(h);
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return k;
}

void main() {
  vec2 uv = isf_FragNormCoord - 0.5;
  // project onto chosen direction so it reads on strips and matrices
  float axis = uv.x * cos(angle) + uv.y * sin(angle) + 0.5;

  float h = axis * bands + TIME * speed;
  vec3 rainbow = hue2rgb(h);

  // mix toward white for desaturation control
  vec3 col = mix(vec3(1.0), rainbow, saturation);
  gl_FragColor = vec4(col * brightness, 1.0);
}
