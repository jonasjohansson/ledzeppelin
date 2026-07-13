// The SINGLE source of truth for the chrome palette. Every surface / text / accent
// CSS var is derived from ONE dark anchor set + the accent + the Brightness / Tint /
// Contrast sliders. LIGHT mode = the SAME anchors with inverted luminance, so both
// themes track the sliders (no separate hand-tuned light copy — that used to live,
// duplicated, in prefs.js + settings/settings.js + sync-accent.js).
//
// Dark output is byte-identical to the old hand-tuned dark branch (verified against
// the previous formulas), so dark mode is unchanged; only light is newly derived.

const h2 = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(x || ''); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
// Linear mix a→b by weight w (w=1 → a, w=0 → b). Clamps out-of-range channels, so a
// contrast f>1 can push a text anchor PAST its endpoint (extrapolation) and stay valid.
export const mixHex = (a, b, w) => { const A = h2(a) || [0, 0, 0], B = h2(b) || [0, 0, 0]; return toHex(A[0] * w + B[0] * (1 - w), A[1] * w + B[1] * (1 - w), A[2] * w + B[2] * (1 - w)); };

// Invert a near-neutral anchor's luminance to its light-mode counterpart. The old
// hand-tuned light ramp was ≈ 1 − dark luminance across every surface, so this
// reproduces it while keeping ONE definition. Returns a neutral gray at the target
// luminance (the accent tint below re-introduces the subtle warmth).
function flipL(hex) {
  const [r, g, b] = h2(hex) || [0, 0, 0];
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;   // relative luminance 0..1
  const v = Math.round((1 - L) * 255);
  return toHex(v, v, v);
}

// Dark surface anchors (the tuned base) + their accent-tint weight. Light reuses them
// luminance-inverted. field-bg is nudged toward the ramp extreme in light so inputs
// stay the brightest surface (raised), matching the light convention of white fields.
// Resolume-style: neutral medium-dark grays (no accent tint on chrome — the teal reads
// only where it's an accent). Tint weights are 0 so surfaces stay true neutral gray.
const SURFACES = [
  ['--bg',       '#1c1c1c', 0.0, 0],   // neutral dark chrome (Resolume mid-dark, not near-black)
  ['--field-bg', '#141414', 0.0, 0.5],   // recessed input troughs — darkest; 4th = light-only lift
  ['--panel',    '#242424', 0.0, 0],
  ['--panel-2',  '#2b2b2b', 0.0, 0],
  ['--hover',    '#383838', 0.0, 0],
  ['--line',     '#3a3a3a', 0.0, 0],
  ['--line-2',   '#4c4c4c', 0.0, 0],
];
// Text anchors (dark). Light mirrors them luminance-inverted; contrast mixes toward
// the surface extreme (black in dark, white in light) in the same slider direction.
// Neutral ramp (was blue-gray, fighting the warm accent): equalized RGB, --text
// eased off pure white to soften the near-black/pure-white glare.
const TEXT = [['--text', '#eaeaec'], ['--muted', '#a0a0a5'], ['--faint', '#757579'], ['--readout', '#d3d3d7']];

// Compute the full chrome var map for the given accent + theme + slider values.
export function themeVars({ accent, theme = 'dark', brightness = 0, tint = 100, contrast = 130 } = {}) {
  const light = theme === 'light';
  const hex = h2(accent) ? accent : '#eceef2';
  const tm = tint / 100;              // accent-tint multiplier
  const lift = brightness / 100;      // surface lift toward white (both themes: higher = brighter)
  const f = contrast / 100;           // text contrast (higher = more)
  const vars = { '--accent': hex };

  // Accent variants — contrast against the surface: dark mixes toward black, light toward white.
  vars['--accent-soft'] = light ? mixHex(hex, '#ffffff', 0.82) : mixHex(hex, '#0a0a0a', 0.16);
  vars['--accent-line'] = light ? mixHex(hex, '#ffffff', 0.45) : mixHex(hex, '#0a0a0a', 0.40);
  vars['--accent-text'] = light ? mixHex(hex, '#141414', 0.30) : mixHex(hex, '#ffffff', 0.62);

  // Glyph/text colour ON an accent-FILLED surface (subtabs, view-seg active button,
  // checkbox tick, selected clip/layer labels). Must contrast the accent FILL, not the
  // theme — so it tracks the accent hue AND flips: a light accent gets near-black text,
  // a genuinely dark accent gets near-white (else the old static blue-black vanished).
  const accL = (() => { const [r, g, b] = h2(hex) || [0, 0, 0]; return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; })();
  vars['--accent-dark'] = accL > 0.5 ? mixHex(hex, '#0a0a0a', 0.12) : mixHex(hex, '#f4f4f6', 0.12);

  // Surfaces — anchor (dark, or luminance-inverted for light), lifted by Brightness,
  // then tinted by the accent. Identical formula for both themes.
  for (const [k, dark, w, lightExtra] of SURFACES) {
    let base = light ? flipL(dark) : dark;
    if (light && lightExtra) base = mixHex('#ffffff', base, 1 - lightExtra);   // pull toward white
    const lifted = mixHex('#ffffff', base, lift);   // lift 0 → base; >0 → toward white
    const val = mixHex(hex, lifted, w * tm);
    vars[k] = val;
    if (k === '--panel') vars['--panel-solid'] = val;
  }

  // Text — contrast mixes each anchor toward the surface extreme (mirror per theme).
  for (const [k, dark] of TEXT) vars[k] = light ? mixHex(flipL(dark), '#ffffff', f) : mixHex(dark, '#0c0c10', f);

  // Group-header bar — Resolume fills param/effect group headers with a muted teal so
  // they read as obvious dividers. A desaturated accent over the panel gray (light: over white).
  vars['--accent-head'] = light ? mixHex(hex, '#ffffff', 0.62) : mixHex(hex, vars['--panel-2'], 0.26);

  // Display surfaces (stage / preview pasteboard) stay near-black in BOTH themes — the LED
  // visuals are true-colour on black, and the chrome around them is now medium gray.
  vars['--stage-bg'] = light ? '#0d0d0f' : '#101011';
  return vars;
}

// Apply a var map to a document root (or any element's style).
export function applyVars(vars, styleEl = document.documentElement.style) {
  for (const k in vars) styleEl.setProperty(k, vars[k]);
}
