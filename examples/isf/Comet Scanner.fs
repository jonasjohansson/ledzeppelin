/*{
  "DESCRIPTION": "Comet Scanner",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 1.0 },
    { "NAME": "count", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 1.0 },
    { "NAME": "tail", "TYPE": "float", "MIN": 1.0, "MAX": 60.0, "DEFAULT": 18.0 },
    { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0 },
    { "NAME": "bounce", "TYPE": "bool", "DEFAULT": true },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [1.0, 0.1, 0.05, 1.0] }
  ]
}*/

// Knight-Rider sweep: bright heads with decaying tails

void main() {
  vec2 uv = isf_FragNormCoord - 0.5;
  // position along the sweep axis, 0..1
  float pos = uv.x * cos(angle) + uv.y * sin(angle) + 0.5;

  float t = TIME * speed;
  vec3 col = vec3(0.0);

  for (int i = 0; i < 6; i++) {
    if (float(i) >= count) break;
    // stagger multiple heads evenly across the cycle
    float phase = t + float(i) / max(count, 1.0);
    float head;
    if (bounce) {
      // triangle wave 0..1..0 for a ping-pong scan
      head = abs(fract(phase * 0.5) * 2.0 - 1.0);
    } else {
      head = fract(phase);
    }
    float d = pos - head;
    // comet: sharp leading edge, exponential trailing tail
    float trail = exp(-abs(d) * tail);
    // make the tail one-directional (behind the head)
    float dir = bounce ? 1.0 : step(0.0, -d);
    float glow = trail * mix(0.4, 1.0, dir);
    col += tint.rgb * glow;
  }

  col = min(col, vec3(1.0));
  gl_FragColor = vec4(col, 1.0);
}
