#ifndef LEAP_OSC_CHANNELS_H
#define LEAP_OSC_CHANNELS_H

#define LO_MAX_MSGS 32
#define LO_ADDR_MAX 32

/* One tracked hand, decoupled from LeapC so this module tests anywhere. */
typedef struct {
  float pos[3];            /* palm position, mm (x left->right, y up, z near->far) */
  float vel[3];            /* palm velocity, mm/s */
  float normal[3];         /* palm normal (unit) */
  float dir[3];            /* hand direction (unit) */
  float grab, pinch;       /* 0..1 from the tracker */
  float confidence;        /* 0..1 */
  int   is_left;           /* 1 = left */
  int   extended[5];       /* thumb, index, middle, ring, pinky */
  float finger_dir[5][3];  /* per-finger unit direction (for spread) */
} lo_hand;

/* Calibration - mirrors leap-bridge.js flags exactly. */
typedef struct {
  float xlo, xhi, ylo, yhi, zlo, zhi;                 /* palm mm ranges */
  float xfloor, xceil, yfloor, yceil, zfloor, zceil;  /* 0..1 trims */
  float conf;                                          /* gesture confidence gate */
} lo_cal;

typedef struct { char addr[LO_ADDR_MAX]; float value; } lo_msg;

lo_cal lo_cal_defaults(void);   /* -200..200 / 100..350 / -150..150, trims 0..1, conf 0.2 */

/* Latest frame -> messages. Returns the count written (<= max).
   0 hands  -> /leap/hand/... relax (y/roll/pitch/yaw=0.5, rest 0) + /leap/hands=0
   1 hand   -> /leap/hand/...                + /leap/hands=0.5
   2 hands  -> /leap/left/... + /leap/right/... + /leap/hands=1 */
int lo_channels(const lo_hand *hands, int nhands, const lo_cal *cal,
                lo_msg *out, int max);

#endif
