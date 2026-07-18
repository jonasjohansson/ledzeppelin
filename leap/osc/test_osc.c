#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "osc.h"

/* Float -> big-endian uint32 bits, mirroring wr_u32 in osc.c. */
static unsigned f2be(float v) {
  unsigned bits;
  memcpy(&bits, &v, 4);
  return bits;
}

static void check_be(const unsigned char *p, unsigned v) {
  assert(p[0] == ((v >> 24) & 0xff));
  assert(p[1] == ((v >> 16) & 0xff));
  assert(p[2] == ((v >> 8) & 0xff));
  assert(p[3] == (v & 0xff));
}

static void run_asserts(void) {
  unsigned char buf[256];

  /* 1. exact 12-byte layout for "/a" = 1.0f */
  int n = osc_message(buf, sizeof buf, "/a", 1.0f);
  assert(n == 12);
  assert(buf[0] == '/'); assert(buf[1] == 'a');
  assert(buf[2] == 0);   assert(buf[3] == 0);
  assert(buf[4] == ','); assert(buf[5] == 'f');
  assert(buf[6] == 0);   assert(buf[7] == 0);
  assert(buf[8]  == 0x3F); assert(buf[9]  == 0x80);
  assert(buf[10] == 0x00); assert(buf[11] == 0x00);
  assert(f2be(1.0f) == 0x3F800000u);
  check_be(buf + 8, f2be(1.0f));

  /* 2. length-4 address pads to 8 (NUL-terminated AND 4-aligned) */
  n = osc_message(buf, sizeof buf, "/abc", 0.25f);
  assert(n == 16);                 /* 8 + 4 (",f\0\0") + 4 (float) */
  assert(buf[4] == 0);             /* the required terminating NULs */
  assert(buf[5] == 0);
  assert(buf[6] == 0);
  assert(buf[7] == 0);
  assert(buf[8] == ','); assert(buf[9] == 'f');   /* type tag at offset 8 */
  assert(buf[10] == 0);  assert(buf[11] == 0);
  check_be(buf + 12, f2be(0.25f));
  assert(f2be(0.25f) == 0x3E800000u);

  /* 3. bundle of 1 message */
  lo_msg one[1];
  strcpy(one[0].addr, "/a");
  one[0].value = 1.0f;
  int mlen = osc_message(buf, sizeof buf, "/a", 1.0f);  /* = 12 */
  unsigned char bun[256];
  int bn = osc_bundle(bun, sizeof bun, one, 1);
  assert(bn == 20 + mlen);
  assert(memcmp(bun, "#bundle\0", 8) == 0);
  /* timetag: immediate = 00 00 00 00 00 00 00 01 */
  for (int i = 8; i < 15; i++) assert(bun[i] == 0);
  assert(bun[15] == 1);
  /* size field (int32 BE) at 16..19 == message length */
  check_be(bun + 16, (unsigned)mlen);
  /* the message body follows and matches a standalone encode */
  assert(memcmp(bun + 20, buf, mlen) == 0);

  /* 4. cap too small -> -1 */
  assert(osc_message(buf, 11, "/a", 1.0f) == -1);   /* needs 12 */
  assert(osc_message(buf, 12, "/a", 1.0f) == 12);   /* exact fits */
  assert(osc_bundle(bun, 15, one, 1) == -1);        /* < 16 header */
  /* bundle whose message overflows cap: header(16)+size(4)+msg(12)=32 needed */
  assert(osc_bundle(bun, 31, one, 1) == -1);
  assert(osc_bundle(bun, 32, one, 1) == 32);

  printf("test_osc: all passed\n");
}

/* Sample 2-message bundle for the Node cross-check. */
static int emit(void) {
  lo_msg msgs[2];
  strcpy(msgs[0].addr, "/leap/hand/x"); msgs[0].value = 0.25f;
  strcpy(msgs[1].addr, "/leap/hands");  msgs[1].value = 0.5f;
  unsigned char buf[256];
  int n = osc_bundle(buf, sizeof buf, msgs, 2);
  if (n < 0) return 1;
  fwrite(buf, 1, (size_t)n, stdout);
  return 0;
}

int main(int argc, char **argv) {
  if (argc > 1 && strcmp(argv[1], "--emit") == 0) return emit();
  run_asserts();
  return 0;
}
