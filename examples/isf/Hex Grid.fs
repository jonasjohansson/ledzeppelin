/*{
  "DESCRIPTION": "Hex Grid",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "scale", "TYPE": "float", "MIN": 2.0, "MAX": 24.0, "DEFAULT": 8.0 },
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 0.8 },
    { "NAME": "thickness", "TYPE": "float", "MIN": 0.02, "MAX": 0.5, "DEFAULT": 0.15 },
    { "NAME": "colorA", "TYPE": "color", "DEFAULT": [0.0, 0.05, 0.1, 1.0] },
    { "NAME": "colorB", "TYPE": "color", "DEFAULT": [0.2, 1.0, 0.9, 1.0] }
  ]
}*/

// returns xy = local coord inside hex cell, zw = cell id
vec4 hexCoord(vec2 p) {
  vec2 r = vec2(1.0, 1.73205080757);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p + h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = p - gv;
  return vec4(gv, id);
}

void main() {
  vec2 p = isf_FragNormCoord - 0.5;
  p.x *= RENDERSIZE.x / RENDERSIZE.y;

  float t = TIME * speed;
  vec2 gp = p * scale;
  gp.y += t; // scroll

  vec4 hc = hexCoord(gp);
  vec2 gv = hc.xy;
  vec2 id = hc.zw;

  // distance to nearest hex edge
  vec2 ag = abs(gv);
  float edge = max(max(ag.x * 1.15470053838 + ag.y * 0.5, ag.y), ag.x);
  float d = 0.5 - edge;
  float outline = smoothstep(0.0, thickness, d);

  // per-cell pulse driven by cell id
  float pulse = 0.5 + 0.5 * sin(t * 2.0 + id.x * 1.3 + id.y * 0.9);

  vec3 cell = mix(colorA.rgb, colorB.rgb, pulse);
  vec3 col = mix(colorB.rgb * 1.2, cell, outline);
  // glow center of each hex
  col += colorB.rgb * pulse * smoothstep(0.5, 0.0, length(gv)) * 0.4;

  gl_FragColor = vec4(col, 1.0);
}
