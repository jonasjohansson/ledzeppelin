#version 300 es
precision highp float;
in vec2 uv; out vec4 frag;
uniform float pos;
uniform float width;
uniform float angle;
void main(){
  float a = radians(angle);
  float coord = uv.x*cos(a) + uv.y*sin(a);
  float d = abs(coord - pos);
  float v = smoothstep(width, 0.0, d);
  frag = vec4(vec3(v), 1.0);
}
