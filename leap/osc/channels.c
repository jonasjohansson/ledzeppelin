#include <math.h>
#include <stdio.h>
#include <string.h>
#include "channels.h"

/* glibc's <math.h> only defines M_PI outside strict-ISO mode; we compile with
   -std=c99, so define it ourselves (Apple's libc defines it unconditionally). */
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static float clamp01(float v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
static float remapf(float v, float lo, float hi) { return hi > lo ? clamp01((v - lo) / (hi - lo)) : 0; }
/* Re-stretch an already-normalised 0..1 value so [floor..ceil] fills 0..1. */
static float trimf(float v, float fl, float ce) { return ce > fl ? clamp01((v - fl) / (ce - fl)) : v; }

lo_cal lo_cal_defaults(void) {
  lo_cal c = { -200, 200, 100, 350, -150, 150,  0, 1, 0, 1, 0, 1,  0.2f };
  return c;
}

/* Palm normal + direction -> roll/pitch/yaw, -180..+180deg -> 0..1 (0.5 = neutral).
   Same atan2 axes as leap-bridge.js palmAngles(). */
static void palm_angles(const lo_hand *h, float *roll, float *pitch, float *yaw) {
  const float RAD2DEG = 180.0f / (float)M_PI;
  *roll  = (atan2f(h->normal[0], -h->normal[1]) * RAD2DEG + 180.0f) / 360.0f;
  *pitch = (atan2f(h->dir[1],    -h->dir[2])    * RAD2DEG + 180.0f) / 360.0f;
  *yaw   = (atan2f(h->dir[0],    -h->dir[2])    * RAD2DEG + 180.0f) / 360.0f;
}

/* Average angle between adjacent extended-finger directions, /(pi/4), clamped. */
static float finger_spread(const lo_hand *h) {
  float dirs[5][3]; int nd = 0;
  for (int i = 0; i < 5; i++) {
    if (!h->extended[i]) continue;
    const float *d = h->finger_dir[i];
    /* Skip a degenerate (zero-length) bone: dot=0 -> acos(0)=pi/2 would wrongly
       read as a wide spread. A missing distal bone contributes no angle. */
    if (d[0]*d[0] + d[1]*d[1] + d[2]*d[2] < 1e-6f) continue;
    memcpy(dirs[nd], d, sizeof dirs[0]); nd++;
  }
  if (nd < 2) return 0;
  float sum = 0; int n = 0;
  for (int i = 1; i < nd; i++) {
    const float *a = dirs[i - 1], *b = dirs[i];
    float dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    sum += acosf(clamp01(fabsf(dot)));
    n++;
  }
  return n ? clamp01((sum / n) / ((float)M_PI / 4.0f)) : 0;
}

/* Index out, AT MOST ONE of middle/ring/pinky out (thumb ignored). */
static float point_strength(const lo_hand *h) {
  if (!h->extended[1]) return 0;
  int others = h->extended[2] + h->extended[3] + h->extended[4];
  return others <= 1 ? 1.0f : 0.0f;
}

static int put(lo_msg *out, int n, int max, const char *prefix, const char *name, float v) {
  if (n >= max) return n;
  snprintf(out[n].addr, LO_ADDR_MAX, "%s%s", prefix, name);
  out[n].value = v;
  return n + 1;
}

int lo_channels(const lo_hand *hands, int nhands, const lo_cal *cal, lo_msg *out, int max) {
  int n = 0;
  if (nhands > 2) nhands = 2;   /* only /leap/left + /leap/right exist */
  n = put(out, n, max, "/leap", "/hands", clamp01(nhands / 2.0f));

  for (int i = 0; i < nhands; i++) {
    const lo_hand *h = &hands[i];
    /* One hand -> /leap/hand. Two hands -> name by handedness, but if both hands
       report the same (LeapC misclassification, or two same-handed people) give
       the second the opposite prefix so their OSC addresses never collide. */
    const char *prefix;
    if (nhands <= 1) prefix = "/leap/hand";
    else {
      int left = h->is_left;
      if (i > 0 && hands[i].is_left == hands[0].is_left) left = !hands[0].is_left;
      prefix = left ? "/leap/left" : "/leap/right";
    }

    n = put(out, n, max, prefix, "/x", trimf(remapf(h->pos[0], cal->xlo, cal->xhi), cal->xfloor, cal->xceil));
    n = put(out, n, max, prefix, "/y", trimf(remapf(h->pos[1], cal->ylo, cal->yhi), cal->yfloor, cal->yceil));
    n = put(out, n, max, prefix, "/z", trimf(remapf(h->pos[2], cal->zlo, cal->zhi), cal->zfloor, cal->zceil));

    n = put(out, n, max, prefix, "/grab",  clamp01(h->grab));
    n = put(out, n, max, prefix, "/pinch", clamp01(h->pinch));

    float roll, pitch, yaw;
    palm_angles(h, &roll, &pitch, &yaw);
    n = put(out, n, max, prefix, "/roll",  roll);
    n = put(out, n, max, prefix, "/pitch", pitch);
    n = put(out, n, max, prefix, "/yaw",   yaw);

    n = put(out, n, max, prefix, "/spread", finger_spread(h));

    /* Gesture channels only when confidently tracked - at the FOV edge the
       Leap drops the fingers and reports a phantom fist. */
    int tracked = h->confidence >= cal->conf;
    float point = tracked ? point_strength(h) : 0;
    int fist    = tracked && clamp01(h->grab) >= 0.5f;
    n = put(out, n, max, prefix, "/point", point);
    n = put(out, n, max, prefix, "/ball",  (fist || point > 0) ? 1.0f : 0.0f);

    float speed = sqrtf(h->vel[0]*h->vel[0] + h->vel[1]*h->vel[1] + h->vel[2]*h->vel[2]);
    n = put(out, n, max, prefix, "/vel", remapf(speed, 0, 1500));
  }

  /* No hand visible: relax the bound channels so params return to neutral.
     Always relax /leap/hand; if we just dropped from two hands, also relax
     /leap/left + /leap/right for this one transition frame (they'd otherwise
     freeze at their last value). last_seen keeps sustained idle at 13 msgs,
     not 37 — important for the always-on Pi's websocket traffic. */
  static int last_seen = 0;
  if (!nhands) {
    static const char *keys[] = { "/x", "/y", "/z", "/grab", "/pinch", "/roll", "/pitch", "/yaw", "/spread", "/vel", "/point", "/ball" };
    const char *prefixes[3]; int np = 0;
    prefixes[np++] = "/leap/hand";
    if (last_seen > 1) { prefixes[np++] = "/leap/left"; prefixes[np++] = "/leap/right"; }
    for (int p = 0; p < np; p++)
      for (unsigned k = 0; k < sizeof keys / sizeof *keys; k++) {
        int neutral = !strcmp(keys[k], "/y") || !strcmp(keys[k], "/roll") || !strcmp(keys[k], "/pitch") || !strcmp(keys[k], "/yaw");
        n = put(out, n, max, prefixes[p], keys[k], neutral ? 0.5f : 0.0f);
      }
  }
  last_seen = nhands;
  return n;
}
