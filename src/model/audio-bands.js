// Fixture → audio band assignment (for the "Audio Bars" volumetric source).
//
// Each fixture is tagged with ONE frequency band — bass / mid / high — auto-mapped
// from its NAME (Tail thumps on bass, Ribs shimmer on mids, Fins sparkle on highs),
// with an optional per-fixture override. Pure + zero-dep so it can be unit-tested
// and reused by the pipeline (per-LED band array) and any inspector UI.

// Stable band order — the GLSL sampler indexes uAudioBands with these (0=bass,
// 1=mid, 2=high) and the field colours bass=colA / high=colB / mid=mix.
export const BANDS = ['bass', 'mid', 'high'];
export const BAND_INDEX = { bass: 0, mid: 1, high: 2 };

// Name → band keyword rules, in priority order. First match wins.
const NAME_RULES = [
  [/tail/i, 'bass'],
  [/rib/i, 'mid'],
  [/fin/i, 'high'],
  [/spline/i, 'mid'],
];

// Pure: the band ('bass'|'mid'|'high') for a fixture. An explicit override
// ('bass'|'mid'|'high') wins; otherwise the name is matched against the keyword
// rules; anything unmatched (or a blank/absent name) defaults to 'mid'.
// `override` of 'auto' / null / undefined / anything else falls through to the name.
export function fixtureBand(name, override) {
  if (override && BAND_INDEX[override] != null) return override;
  const s = String(name || '');
  for (const [re, band] of NAME_RULES) if (re.test(s)) return band;
  return 'mid';
}

// Same rule, as the numeric index (0=bass, 1=mid, 2=high) the sampler wants.
export function fixtureBandIndex(name, override) {
  return BAND_INDEX[fixtureBand(name, override)];
}
