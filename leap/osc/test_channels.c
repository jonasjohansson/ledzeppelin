#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "channels.h"

static lo_msg M[LO_MAX_MSGS];

static float get(int n, const char *addr) {
  for (int i = 0; i < n; i++) if (!strcmp(M[i].addr, addr)) return M[i].value;
  assert(!"channel missing"); return -1;
}
static int has(int n, const char *addr) {
  for (int i = 0; i < n; i++) if (!strcmp(M[i].addr, addr)) return 1;
  return 0;
}
/* Centred open hand: palm at (0, 225, 0) = middle of every default axis range. */
static lo_hand centred(void) {
  lo_hand h; memset(&h, 0, sizeof h);
  h.pos[1] = 225.0f;
  h.normal[1] = -1.0f;   /* palm down  -> roll 0.5  */
  h.dir[2]    = -1.0f;   /* forward    -> pitch/yaw 0.5 */
  h.confidence = 1.0f;
  return h;
}

int main(void) {
  lo_cal cal = lo_cal_defaults();
  lo_hand h; int n;

  /* centred open hand -> middle of each axis, one hand */
  h = centred();
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(fabsf(get(n, "/leap/hand/x") - 0.5f) < 1e-6f);
  assert(fabsf(get(n, "/leap/hand/y") - 0.5f) < 1e-6f);   /* 225mm in 100..350 */
  assert(fabsf(get(n, "/leap/hand/z") - 0.5f) < 1e-6f);
  assert(get(n, "/leap/hand/grab") == 0.0f);
  assert(get(n, "/leap/hand/ball") == 0.0f);
  assert(get(n, "/leap/hands") == 0.5f);
  /* orientation neutral */
  assert(fabsf(get(n, "/leap/hand/roll")  - 0.5f) < 1e-3f);
  assert(fabsf(get(n, "/leap/hand/pitch") - 0.5f) < 1e-3f);
  assert(fabsf(get(n, "/leap/hand/yaw")   - 0.5f) < 1e-3f);

  /* tilted orientation: neutral is 0.5 for ANY atan2 sign, so tilt each axis
     45 deg to pin the sign/axis of roll/pitch/yaw (0.625 = +45, 0.375 = -45). */
  h = centred(); h.normal[0] = 0.70710678f; h.normal[1] = -0.70710678f;  /* roll +45 */
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(fabsf(get(n, "/leap/hand/roll")  - 0.625f) < 1e-3f);
  assert(fabsf(get(n, "/leap/hand/pitch") - 0.5f)   < 1e-3f);  /* dir untouched */
  assert(fabsf(get(n, "/leap/hand/yaw")   - 0.5f)   < 1e-3f);
  h = centred(); h.normal[0] = -0.70710678f; h.normal[1] = -0.70710678f; /* roll -45 */
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(fabsf(get(n, "/leap/hand/roll")  - 0.375f) < 1e-3f);
  h = centred(); h.dir[1] = 0.70710678f; h.dir[2] = -0.70710678f;        /* pitch +45 */
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(fabsf(get(n, "/leap/hand/pitch") - 0.625f) < 1e-3f);
  assert(fabsf(get(n, "/leap/hand/yaw")   - 0.5f)   < 1e-3f);
  h = centred(); h.dir[0] = 0.70710678f; h.dir[2] = -0.70710678f;        /* yaw +45 */
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(fabsf(get(n, "/leap/hand/yaw")   - 0.625f) < 1e-3f);
  assert(fabsf(get(n, "/leap/hand/pitch") - 0.5f)   < 1e-3f);

  /* pinch: raw value passes through clamped */
  h = centred(); h.pinch = 0.7f;
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(fabsf(get(n, "/leap/hand/pinch") - 0.7f) < 1e-6f);

  /* finger spread: two fingers 22.5 deg apart -> (pi/8)/(pi/4) = 0.5 (un-clamped) */
  h = centred(); h.extended[1] = 1; h.extended[2] = 1;
  h.finger_dir[1][2] = -1.0f;                                  /* index: straight forward */
  h.finger_dir[2][0] = 0.38268343f; h.finger_dir[2][2] = -0.92387953f;  /* middle: +22.5 */
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(fabsf(get(n, "/leap/hand/spread") - 0.5f) < 1e-3f);

  /* confidence gate suppresses the phantom edge fist */
  h = centred(); h.grab = 1.0f;
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(get(n, "/leap/hand/ball") == 1.0f);              /* real fist -> ball */
  h.confidence = 0.1f;
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(get(n, "/leap/hand/grab") == 1.0f);              /* raw grab still reported */
  assert(get(n, "/leap/hand/ball") == 0.0f);              /* gesture gated off */
  assert(get(n, "/leap/hand/point") == 0.0f);

  /* index point: index out, <=1 of middle/ring/pinky out (thumb ignored) */
  h = centred(); h.extended[1] = 1;
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(get(n, "/leap/hand/point") == 1.0f);
  assert(get(n, "/leap/hand/ball") == 1.0f);              /* ball = fist OR point */
  h.extended[0] = 1;                                       /* thumb ignored */
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(get(n, "/leap/hand/point") == 1.0f);
  h.extended[2] = 1;                                       /* one other out -> tolerated */
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(get(n, "/leap/hand/point") == 1.0f);
  h.extended[3] = 1;                                       /* two others out -> not a point */
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(get(n, "/leap/hand/point") == 0.0f);

  /* no hands relax to neutral */
  n = lo_channels(NULL, 0, &cal, M, LO_MAX_MSGS);
  assert(get(n, "/leap/hand/y") == 0.5f);
  assert(get(n, "/leap/hand/roll") == 0.5f);
  assert(get(n, "/leap/hand/grab") == 0.0f);
  assert(get(n, "/leap/hand/ball") == 0.0f);
  assert(get(n, "/leap/hands") == 0.0f);

  /* two hands split into /leap/left + /leap/right */
  lo_hand two[2] = { centred(), centred() };
  two[0].is_left = 1;
  n = lo_channels(two, 2, &cal, M, LO_MAX_MSGS);
  assert(has(n, "/leap/left/x"));
  assert(has(n, "/leap/right/x"));
  assert(get(n, "/leap/hands") == 1.0f);

  /* trims: floor 0.2 pins the bottom 20% to 0 and rescales */
  cal.yfloor = 0.2f;
  h = centred(); h.pos[1] = 150.0f;                        /* raw 0.2 -> trimmed 0 */
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(get(n, "/leap/hand/y") == 0.0f);
  h.pos[1] = 225.0f;                                       /* raw 0.5 -> (0.5-0.2)/0.8 */
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(fabsf(get(n, "/leap/hand/y") - 0.375f) < 1e-6f);

  /* trims: ceil 0.8 rescales so raw 0.8 pins to 1.0 (top of range) */
  cal = lo_cal_defaults(); cal.yceil = 0.8f;
  h = centred(); h.pos[1] = 300.0f;                        /* raw 0.8 -> trimmed 1.0 */
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(fabsf(get(n, "/leap/hand/y") - 1.0f) < 1e-6f);

  /* velocity: 1500 mm/s = 1.0, clamped */
  cal = lo_cal_defaults();
  h = centred(); h.vel[0] = 3000.0f;
  n = lo_channels(&h, 1, &cal, M, LO_MAX_MSGS);
  assert(get(n, "/leap/hand/vel") == 1.0f);

  printf("test_channels: all passed\n");
  return 0;
}
