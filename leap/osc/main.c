/* leap-osc — read hand tracking, stream normalized /leap OSC/UDP channels.
   main.c wires the pieces: flags -> lo_cal, a swappable frame source (feed.h),
   and a timed feed_poll -> lo_channels -> osc_bundle -> sendto loop.

   Both feeds can be linked into one binary, so each prefixes its symbols
   (fake_feed_* / leapc_feed_*, see feed.h). We pick one at startup via a pair
   of function pointers: --fake -> the synthetic feed; otherwise the LeapC feed
   when HAVE_LEAPC is defined, else bail with a hint (that build has no real
   source). --fake works in either build — it's the no-hardware spoof. */
#include <arpa/inet.h>
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "channels.h"
#include "feed.h"
#include "osc.h"

static volatile sig_atomic_t running = 1;
static void on_signal(int sig) { (void)sig; running = 0; }

static const char *USAGE =
  "usage: leap-osc [options]\n"
  "  --fake                use the synthetic feed (no hardware)\n"
  "  --verbose             log hand/message counts per frame to stderr\n"
  "  --rate N              send rate Hz, clamped 1..120 (default 40)\n"
  "  --host ADDR           destination host (default 127.0.0.1)\n"
  "  --port N              destination UDP port (default 9000)\n"
  "  --xlo/--xhi F         palm X range mm (default -200..200)\n"
  "  --ylo/--yhi F         palm Y range mm (default 100..350)\n"
  "  --zlo/--zhi F         palm Z range mm (default -150..150)\n"
  "  --xfloor/--xceil F    X 0..1 trim (default 0..1)\n"
  "  --yfloor/--yceil F    Y 0..1 trim (default 0..1)\n"
  "  --zfloor/--zceil F    Z 0..1 trim (default 0..1)\n"
  "  --conf F              gesture confidence gate (default 0.2)\n"
  "  --help                print this and exit\n";

/* Return the value following --name in argv, or NULL if absent/missing. */
static const char *flag(int argc, char **argv, const char *name) {
  for (int i = 1; i < argc; i++)
    if (!strcmp(argv[i], name)) return i + 1 < argc ? argv[i + 1] : "";
  return NULL;
}
static int has(int argc, char **argv, const char *name) {
  for (int i = 1; i < argc; i++) if (!strcmp(argv[i], name)) return 1;
  return 0;
}
static float numflag(int argc, char **argv, const char *name, float def) {
  const char *v = flag(argc, argv, name);
  return v && *v ? (float)atof(v) : def;
}

/* Every flag this program understands — anything else is an error. */
static const char *KNOWN[] = {
  "--fake", "--verbose", "--help", "--rate", "--host", "--port",
  "--xlo", "--xhi", "--ylo", "--yhi", "--zlo", "--zhi",
  "--xfloor", "--xceil", "--yfloor", "--yceil", "--zfloor", "--zceil", "--conf",
};
/* Value-taking flags — their argument is skipped when scanning for unknowns. */
static int takes_value(const char *a) {
  return strcmp(a, "--fake") && strcmp(a, "--verbose") && strcmp(a, "--help");
}

int main(int argc, char **argv) {
  if (has(argc, argv, "--help")) { fputs(USAGE, stdout); return 0; }

  /* Reject unknown flags (skip the value that follows a known value-flag). */
  for (int i = 1; i < argc; i++) {
    int known = 0;
    for (unsigned k = 0; k < sizeof KNOWN / sizeof *KNOWN; k++)
      if (!strcmp(argv[i], KNOWN[k])) { known = 1; break; }
    if (!known) {
      fprintf(stderr, "leap-osc: unknown flag '%s'\n%s", argv[i], USAGE);
      return 2;
    }
    if (takes_value(argv[i])) i++;   /* consume its argument */
  }

  int fake    = has(argc, argv, "--fake");
  int verbose = has(argc, argv, "--verbose");

  int rate = (int)numflag(argc, argv, "--rate", 40);
  if (rate < 1) rate = 1;
  if (rate > 120) rate = 120;

  const char *host = flag(argc, argv, "--host");
  if (!host || !*host) host = "127.0.0.1";
  int port = (int)numflag(argc, argv, "--port", 9000);

  lo_cal cal = lo_cal_defaults();
  cal.xlo = numflag(argc, argv, "--xlo", cal.xlo);
  cal.xhi = numflag(argc, argv, "--xhi", cal.xhi);
  cal.ylo = numflag(argc, argv, "--ylo", cal.ylo);
  cal.yhi = numflag(argc, argv, "--yhi", cal.yhi);
  cal.zlo = numflag(argc, argv, "--zlo", cal.zlo);
  cal.zhi = numflag(argc, argv, "--zhi", cal.zhi);
  cal.xfloor = numflag(argc, argv, "--xfloor", cal.xfloor);
  cal.xceil  = numflag(argc, argv, "--xceil",  cal.xceil);
  cal.yfloor = numflag(argc, argv, "--yfloor", cal.yfloor);
  cal.yceil  = numflag(argc, argv, "--yceil",  cal.yceil);
  cal.zfloor = numflag(argc, argv, "--zfloor", cal.zfloor);
  cal.zceil  = numflag(argc, argv, "--zceil",  cal.zceil);
  cal.conf   = numflag(argc, argv, "--conf",   cal.conf);

  /* Pick the frame source once. Default to the fake feed; a real run needs
     the LeapC feed, which only exists when built with the SDK. */
  int (*feed_open_fn)(void)          = fake_feed_open;
  int (*feed_poll_fn)(lo_hand *, int) = fake_feed_poll;
  if (!fake) {
#ifdef HAVE_LEAPC
    feed_open_fn = leapc_feed_open;
    feed_poll_fn = leapc_feed_poll;
#else
    fputs("built without LeapC — run with --fake, or build on the mini\n", stderr);
    return 1;
#endif
  }

  /* UDP socket — connectionless, so one sendto per frame, no reconnect. */
  int sock = socket(AF_INET, SOCK_DGRAM, 0);
  if (sock < 0) { fprintf(stderr, "leap-osc: socket: %s\n", strerror(errno)); return 1; }

  struct sockaddr_in dst;
  memset(&dst, 0, sizeof dst);
  dst.sin_family = AF_INET;
  dst.sin_port = htons((unsigned short)port);
  if (inet_pton(AF_INET, host, &dst.sin_addr) != 1) {
    fprintf(stderr, "leap-osc: bad host '%s'\n", host);
    close(sock);
    return 1;
  }

  if (feed_open_fn() != 0) {
    fprintf(stderr, "leap-osc: feed_open failed\n");
    close(sock);
    return 1;
  }

  signal(SIGINT, on_signal);
  signal(SIGTERM, on_signal);

  /* Fixed per-tick sleep. We don't subtract work time — at these rates the
     drift is negligible and keeping it simple avoids a clock read per frame.
     Split seconds/nanos so rate==1 (period 1e9 ns) stays a valid timespec. */
  long ns = 1000000000L / rate;
  struct timespec period = { ns / 1000000000L, ns % 1000000000L };

  fprintf(stderr, "leap-osc: %s feed -> %s:%d @ %d Hz\n",
          fake ? "fake" : "leapc", host, port, rate);

  lo_hand hands[2];
  lo_msg  msgs[LO_MAX_MSGS];
  unsigned char pkt[2048];

  while (running) {
    int nh = feed_poll_fn(hands, 2);
    if (nh < 0) { fprintf(stderr, "leap-osc: feed_poll error\n"); break; }

    int nm = lo_channels(hands, nh, &cal, msgs, LO_MAX_MSGS);
    int nb = osc_bundle(pkt, sizeof pkt, msgs, nm);
    /* Always send — 0 hands is the relax frame downstream params depend on. */
    if (nb > 0) sendto(sock, pkt, (size_t)nb, 0, (struct sockaddr *)&dst, sizeof dst);

    if (verbose) fprintf(stderr, "frame hands=%d msgs=%d\n", nh, nm);

    nanosleep(&period, NULL);
  }

  close(sock);
  return 0;
}
