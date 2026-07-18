#include <string.h>
#include "osc.h"

static int pad4(int n) { return (n + 4) & ~3; }   /* incl. at least one NUL */

static void wr_u32(unsigned char *p, unsigned v) {
  p[0] = v >> 24; p[1] = v >> 16; p[2] = v >> 8; p[3] = v;
}

int osc_message(unsigned char *buf, int cap, const char *addr, float value) {
  int alen = pad4((int)strlen(addr));
  int total = alen + 4 + 4;                        /* addr + ",f\0\0" + float */
  if (total > cap) return -1;
  memset(buf, 0, alen);
  memcpy(buf, addr, strlen(addr));
  memcpy(buf + alen, ",f\0\0", 4);
  unsigned bits;
  memcpy(&bits, &value, 4);
  wr_u32(buf + alen + 4, bits);
  return total;
}

int osc_bundle(unsigned char *buf, int cap, const lo_msg *msgs, int n) {
  if (cap < 16) return -1;
  memcpy(buf, "#bundle\0", 8);
  memset(buf + 8, 0, 8);
  buf[15] = 1;                                     /* timetag: immediate */
  int off = 16;
  for (int i = 0; i < n; i++) {
    int sz = osc_message(buf + off + 4, cap - off - 4, msgs[i].addr, msgs[i].value);
    if (sz < 0) return -1;
    wr_u32(buf + off, (unsigned)sz);
    off += 4 + sz;
  }
  return off;
}
