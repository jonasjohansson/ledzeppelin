/*{
  "DESCRIPTION": "Breathing Wash",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "MIN": 0.05, "MAX": 3.0, "DEFAULT": 0.4 },
    { "NAME": "low", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1 },
    { "NAME": "high", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0 },
    { "NAME": "shape", "TYPE": "float", "MIN": 0.2, "MAX": 4.0, "DEFAULT": 1.6 },
    { "NAME": "color", "TYPE": "color", "DEFAULT": [0.2, 0.5, 1.0, 1.0] }
  ]
}*/

// solid colour wash pulsing brightness on a smooth sine breath

void main() {
  // sine breath 0..1
  float s = 0.5 + 0.5 * sin(TIME * speed * 6.2832);
  // shape the curve: >1 holds the dark longer (slow inhale), <1 holds bright
  s = pow(s, shape);
  float b = mix(low, high, s);
  gl_FragColor = vec4(color.rgb * b, 1.0);
}
