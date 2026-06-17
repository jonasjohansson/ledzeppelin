/*{
  "DESCRIPTION": "Lava Lamp",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.4 },
    { "NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 8.0, "DEFAULT": 3.0 },
    { "NAME": "blobs", "TYPE": "float", "MIN": 2.0, "MAX": 12.0, "DEFAULT": 6.0 },
    { "NAME": "warm", "TYPE": "color", "DEFAULT": [1.0, 0.35, 0.05, 1.0] },
    { "NAME": "cool", "TYPE": "color", "DEFAULT": [0.6, 0.0, 0.5, 1.0] }
  ]
}*/

// metaball lava lamp: summed inverse-distance blobs rising and morphing

void main() {
  vec2 uv = isf_FragNormCoord;
  // keep aspect so blobs stay round on wide LED matrices
  uv.x *= RENDERSIZE.x / RENDERSIZE.y;
  uv *= scale;

  float t = TIME * speed;
  float field = 0.0;

  for (int i = 0; i < 12; i++) {
    if (float(i) >= blobs) break;
    float fi = float(i);
    // each blob drifts on its own slow lissajous path
    vec2 c;
    c.x = (0.5 + 0.45 * sin(t * (0.6 + fi * 0.13) + fi * 2.39)) * scale * (RENDERSIZE.x / RENDERSIZE.y);
    c.y = (0.5 + 0.45 * sin(t * (0.5 + fi * 0.17) + fi * 1.11)) * scale;
    float r = 0.35 + 0.18 * sin(t * 0.7 + fi);
    float d = length(uv - c);
    field += (r * r) / (d * d + 0.02);
  }

  // smooth threshold into a glowing surface
  float m = smoothstep(0.6, 1.8, field);
  float glow = smoothstep(0.2, 1.2, field);

  vec3 col = mix(cool.rgb * 0.15, cool.rgb, glow);
  col = mix(col, warm.rgb, m);
  // hot cores
  col += warm.rgb * smoothstep(2.2, 4.0, field) * 0.6;

  gl_FragColor = vec4(col, 1.0);
}
