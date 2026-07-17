#include <math.h>
#include <stdio.h>
#include <string.h>
#include "channels.h"

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
  for (int i = 0; i < 5; i++) if (h->extended[i]) { memcpy(dirs[nd], h->finger_dir[i], sizeof dirs[0]); nd++; }
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
    const char *prefix = nhands > 1 ? (h->is_left ? "/leap/left" : "/leap/right") : "/leap/hand";

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

  /* No hand visible: zero the generic channels so bound params relax. */
  if (!nhands) {
    static const char *keys[]   = { "/x", "/y", "/z", "/grab", "/pinch", "/roll", "/pitch", "/yaw", "/spread", "/vel", "/point", "/ball" };
    for (unsigned k = 0; k < sizeof keys / sizeof *keys; k++) {
      int neutral = !strcmp(keys[k], "/y") || !strcmp(keys[k], "/roll") || !strcmp(keys[k], "/pitch") || !strcmp(keys[k], "/yaw");
      n = put(out, n, max, "/leap/hand", keys[k], neutral ? 0.5f : 0.0f);
    }
  }
  return n;
}
