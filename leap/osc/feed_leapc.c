/* Real hardware feed — Ultraleap LeapC, single-threaded (no lws, no pthread).
   open creates+opens the connection; poll drains the message queue with a
   zero-timeout LeapPollConnection loop, keeping the last Tracking event seen,
   and converts its hands into lo_hand. No new frame this drain -> 0 hands (the
   relax frame). The LeapC service recovers on its own, so there's no reconnect
   logic here: while it's down poll simply keeps timing out and reports 0. */
#include <math.h>
#include <string.h>
#include <LeapC.h>
#include "feed.h"

static LEAP_CONNECTION conn;

int leapc_feed_open(void) {
  if (LeapCreateConnection(NULL, &conn) != eLeapRS_Success) return -1;
  if (LeapOpenConnection(conn) != eLeapRS_Success) return -1;
  return 0;
}

/* Fill dst[0..2] with the unit direction along a distal bone; {0,0,0} if the
   bone has ~zero length (guards against a divide-by-zero on a bad frame). */
static void bone_dir(const LEAP_BONE *bone, float *dst) {
  float dx = bone->next_joint.x - bone->prev_joint.x;
  float dy = bone->next_joint.y - bone->prev_joint.y;
  float dz = bone->next_joint.z - bone->prev_joint.z;
  float len = sqrtf(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6f) return;               /* dst left zeroed by the caller */
  dst[0] = dx / len; dst[1] = dy / len; dst[2] = dz / len;
}

static void convert_hand(const LEAP_HAND *hand, lo_hand *out) {
  lo_hand h;
  memset(&h, 0, sizeof h);

  h.pos[0] = hand->palm.position.x;
  h.pos[1] = hand->palm.position.y;
  h.pos[2] = hand->palm.position.z;

  h.vel[0] = hand->palm.velocity.x;
  h.vel[1] = hand->palm.velocity.y;
  h.vel[2] = hand->palm.velocity.z;

  h.normal[0] = hand->palm.normal.x;
  h.normal[1] = hand->palm.normal.y;
  h.normal[2] = hand->palm.normal.z;

  h.dir[0] = hand->palm.direction.x;
  h.dir[1] = hand->palm.direction.y;
  h.dir[2] = hand->palm.direction.z;

  h.grab       = hand->grab_strength;
  h.pinch      = hand->pinch_strength;
  h.confidence = hand->confidence;
  h.is_left    = hand->type == eLeapHandType_Left;

  for (int d = 0; d < 5; d++) {
    h.extended[d] = hand->digits[d].is_extended;
    bone_dir(&hand->digits[d].distal, h.finger_dir[d]);
  }

  *out = h;
}

int leapc_feed_poll(lo_hand *hands, int max) {
  if (max < 1) return 0;

  /* Drain everything queued, converting each Tracking frame AS WE SEE IT — a
     LeapC event pointer is only valid until the next LeapPollConnection call,
     so we must not hold one across the poll that ends the drain. Last wins. */
  int n = 0, got = 0;
  LEAP_CONNECTION_MESSAGE msg;
  for (;;) {
    eLeapRS r = LeapPollConnection(conn, 0, &msg);
    if (r != eLeapRS_Success) break;     /* timeout/again/error -> done draining */
    if (msg.type != eLeapEventType_Tracking) continue;

    const LEAP_TRACKING_EVENT *frame = msg.tracking_event;
    int nh = (int)frame->nHands;
    if (nh > max) nh = max;
    if (nh > 2) nh = 2;
    for (int i = 0; i < nh; i++) convert_hand(&frame->pHands[i], &hands[i]);
    n = nh; got = 1;
  }
  return got ? n : 0;                     /* no new frame -> 0 hands (relax) */
}
