/*{
  "DESCRIPTION": "Posterize",
  "CATEGORIES": ["Filter", "Color"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "levels", "TYPE": "float", "MIN": 2.0, "MAX": 32.0, "DEFAULT": 5.0 },
    { "NAME": "gamma", "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0 },
    { "NAME": "softness", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0 }
  ]
}*/

void main() {
  vec4 src = IMG_THIS_PIXEL(inputImage);
  vec3 c = clamp(src.rgb, 0.0, 1.0);

  float n = max(floor(levels), 2.0);
  float steps = n - 1.0;

  // Optional gamma so banding sits where you want it.
  vec3 g = pow(c, vec3(gamma));

  vec3 scaled = g * steps;
  vec3 hard = floor(scaled + 0.5) / steps;

  // Optional smoothstep between adjacent bands for soft posterization.
  vec3 lower = floor(scaled) / steps;
  vec3 upper = (floor(scaled) + 1.0) / steps;
  vec3 frac = fract(scaled);
  vec3 soft = mix(lower, upper, smoothstep(0.5 - softness * 0.5, 0.5 + softness * 0.5, frac));

  vec3 quant = mix(hard, soft, step(0.0001, softness));

  // Undo gamma.
  quant = pow(clamp(quant, 0.0, 1.0), vec3(1.0 / gamma));

  gl_FragColor = vec4(quant, src.a);
}
