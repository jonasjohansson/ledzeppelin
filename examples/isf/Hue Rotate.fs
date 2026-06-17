/*{
  "DESCRIPTION": "Hue Rotate",
  "CATEGORIES": ["Filter", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2831853, "DEFAULT": 0.0 },
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.0 },
    { "NAME": "saturation", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0 }
  ]
}*/

void main() {
  vec4 src = IMG_THIS_PIXEL(inputImage);
  vec3 c = src.rgb;

  float a = angle + TIME * speed * 6.2831853;

  // Luma / chroma decomposition (BT.601)
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 chroma = c - luma;

  // Rotate chroma in YIQ-like plane using a hue rotation matrix.
  float cs = cos(a);
  float sn = sin(a);
  mat3 rot = mat3(
    0.299 + 0.701 * cs + 0.168 * sn, 0.587 - 0.587 * cs + 0.330 * sn, 0.114 - 0.114 * cs - 0.497 * sn,
    0.299 - 0.299 * cs - 0.328 * sn, 0.587 + 0.413 * cs + 0.035 * sn, 0.114 - 0.114 * cs + 0.292 * sn,
    0.299 - 0.300 * cs + 1.250 * sn, 0.587 - 0.588 * cs - 1.050 * sn, 0.114 + 0.886 * cs - 0.203 * sn
  );
  vec3 rotated = rot * c;

  // Apply saturation around luma.
  float l2 = dot(rotated, vec3(0.299, 0.587, 0.114));
  vec3 outc = mix(vec3(l2), rotated, saturation);

  gl_FragColor = vec4(clamp(outc, 0.0, 1.0), src.a);
}
