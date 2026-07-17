#ifndef LEAP_OSC_FEED_H
#define LEAP_OSC_FEED_H
#include "channels.h"
/* Open the frame source. Returns 0 on success, -1 on error. */
int feed_open(void);
/* Fill up to `max` hands with the latest frame. Returns hand count (0..max), or -1 on error. */
int feed_poll(lo_hand *hands, int max);
#endif
