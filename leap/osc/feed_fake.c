/* Synthetic single hand — drives the whole pipeline with NO hardware.
   Deterministic: motion comes from a monotonic frame counter, not wall-clock
   or rand(), so runs are reproducible and no extra headers are needed. */
#include <math.h>
#include <string.h>
#include "feed.h"

static long counter = 0;

int feed_open(void) { return 0; }

int feed_poll(lo_hand *hands, int max) {
  if (max < 1) return 0;
  float t = counter * 0.05f;
  counter++;

  lo_hand h;
  memset(&h, 0, sizeof h);

  /* Orbit within the default cal ranges (x -200..200, y 100..350, z -150..150)
     so every position channel sweeps a good part of 0..1. */
  h.pos[0] = 160.0f * sinf(t);
  h.pos[1] = 225.0f + 100.0f * sinf(t * 0.7f);
  h.pos[2] = 120.0f * sinf(t * 1.3f);

  /* Roughly neutral orientation with a gentle wobble for roll/pitch/yaw motion. */
  h.normal[0] = 0.15f * sinf(t);
  h.normal[1] = -1.0f;
  h.dir[0]    = 0.15f * cosf(t);
  h.dir[1]    = 0.15f * sinf(t * 0.5f);
  h.dir[2]    = -1.0f;

  /* Velocity so /leap/hand/vel moves. */
  h.vel[0] = 800.0f * cosf(t);

  /* grab: clean ~1.5 s square wave at 40 Hz; pinch: gentler sine. */
  h.grab  = (counter / 60) % 2 ? 1.0f : 0.0f;
  h.pinch = 0.5f + 0.5f * sinf(t * 0.3f);

  h.confidence = 1.0f;
  h.is_left = 0;

  /* Animate the gesture channels so point/ball/spread aren't frozen (the
     /leap/ monitor needs to see them move). Index + middle always out; ring
     pulses so point/ball toggle; finger separation sweeps so spread fills 0..1. */
  h.extended[1] = 1;
  h.extended[2] = 1;
  h.extended[3] = (counter / 80) % 2;               /* point=1 when clear, 0 when set */
  float a = 0.5f * (0.5f + 0.5f * sinf(t * 0.4f));  /* half-angle sweep */
  h.finger_dir[1][0] = -sinf(a); h.finger_dir[1][2] = -cosf(a);
  h.finger_dir[2][0] =  sinf(a); h.finger_dir[2][2] = -cosf(a);

  hands[0] = h;
  return 1;
}
