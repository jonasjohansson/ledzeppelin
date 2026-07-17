#ifndef LEAP_OSC_OSC_H
#define LEAP_OSC_OSC_H
#include "channels.h"

/* One OSC message: address + ",f" + float32 BE. Returns bytes written, or -1. */
int osc_message(unsigned char *buf, int cap, const char *addr, float value);
/* One '#bundle' (immediate timetag) wrapping n messages — ONE datagram per frame.
   The daemon's parser (server/osc.js) recurses into bundles. Returns bytes or -1. */
int osc_bundle(unsigned char *buf, int cap, const lo_msg *msgs, int n);
#endif
