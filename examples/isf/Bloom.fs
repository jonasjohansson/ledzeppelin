/*{
  "DESCRIPTION": "Bloom",
  "CATEGORIES": ["Filter", "Glow"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "threshold", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6 },
    { "NAME": "radius", "TYPE": "float", "MIN": 0.0, "MAX": 0.05, "DEFAULT": 0.012 },
    { "NAME": "intensity", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 1.4 }
  ]
}*/

// Single-pass approximate bloom: gather a fixed ring of taps around each
// fragment, keep only the bright part, and add it back. No feedback/multi-pass.

vec3 brightPart(vec2 uv) {
  vec3 c = IMG_NORM_PIXEL(inputImage, uv).rgb;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  float k = max(luma - threshold, 0.0) / max(1.0 - threshold, 0.0001);
  return c * k;
}

void main() {
  vec4 src = IMG_THIS_PIXEL(inputImage);
  vec2 uv = isf_FragNormCoord;

  // Correct radius for aspect so the glow is circular.
  vec2 r = vec2(radius, radius * (RENDERSIZE.x / RENDERSIZE.y));

  // 12 offset taps on two rings + centre, gaussian-ish weights.
  vec3 sum = brightPart(uv) * 0.20;
  float wsum = 0.20;

  const int N = 8;
  float inner = 0.6;
  float outer = 1.0;

  for (int i = 0; i < N; i++) {
    float ang = (float(i) / float(N)) * 6.2831853;
    vec2 dir = vec2(cos(ang), sin(ang));

    // Inner ring (heavier weight).
    sum += brightPart(uv + dir * r * inner) * 0.09;
    wsum += 0.09;

    // Outer ring (lighter weight).
    sum += brightPart(uv + dir * r * outer) * 0.045;
    wsum += 0.045;
  }

  vec3 bloom = (sum / wsum) * intensity;

  // Screen-blend the bloom over the original for natural highlights.
  vec3 outc = 1.0 - (1.0 - clamp(src.rgb, 0.0, 1.0)) * (1.0 - clamp(bloom, 0.0, 1.0));

  gl_FragColor = vec4(outc, src.a);
}
