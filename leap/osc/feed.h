#ifndef LEAP_OSC_FEED_H
#define LEAP_OSC_FEED_H
#include "channels.h"
/* A frame source. Two implementations exist and may be linked together, so
   each prefixes its symbols; main.c picks one at startup via function pointers.
   Contract, both feeds: open returns 0 on success, -1 on error; poll fills up
   to `max` hands with the latest frame and returns the count (0..max), or -1. */
int fake_feed_open(void);
int fake_feed_poll(lo_hand *hands, int max);
#ifdef HAVE_LEAPC
int leapc_feed_open(void);
int leapc_feed_poll(lo_hand *hands, int max);
#endif
#endif
