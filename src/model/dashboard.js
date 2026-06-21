// Global "Dashboard" links — named 0..1 control values that live on the composition
// and can modulate any parameter (clip/layer/composition) and DMX channels, like
// Resolume's Dashboard. Knobs are edited in the Composition tab; values persist in
// the show and are fed into the per-frame `signals` map as `dash:<id>`.

// A fixed bank of 18 links, shown as a 6×3 grid (not addable/removable).
export const DASHBOARD_DEFAULT_LINKS = 18;

export const makeDashboardLink = (i) => ({ id: `d${i + 1}`, name: `Link ${i + 1}`, value: 0 });

// Normalise a composition's dashboard: a FIXED bank of DASHBOARD_DEFAULT_LINKS links
// (clean any saved values/names, pad up, and cap to the fixed count).
export function normDashboard(dash) {
  const links = (Array.isArray(dash?.links) ? dash.links : []).map((l, i) => ({
    id: String(l?.id || `d${i + 1}`),
    name: String(l?.name ?? `Link ${i + 1}`),
    value: Math.max(0, Math.min(1, Number(l?.value) || 0)),
  }));
  while (links.length < DASHBOARD_DEFAULT_LINKS) links.push(makeDashboardLink(links.length));
  links.length = DASHBOARD_DEFAULT_LINKS;
  return { links };
}

// Live signal map for the render loop: { 'dash:d1': 0.5, … } (each 0..1).
export function dashboardSignals(composition) {
  const out = {};
  for (const l of composition?.dashboard?.links || []) out[`dash:${l.id}`] = l.value || 0;
  return out;
}

// Options for a "pick a link" dropdown.
export const dashboardLinkOptions = (composition) =>
  (composition?.dashboard?.links || []).map((l) => ({ value: l.id, label: l.name || l.id }));

// A link auto-labels itself from whatever it drives. Reverse-scan the show for the
// things that reference each link — param animations ({mode:'dashboard', link}) on
// clips/layers/composition, and DMX channel binds ('dash:<id>') — and return a map
// linkId → label (the first thing it drives). Used when the link has no manual name.
const prettyParam = (key) => {
  const s = String(key || '').split('.').pop().replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
};
export function dashboardLinkLabels(show) {
  const labels = {};
  const note = (link, label) => { if (link && label && !labels[link]) labels[link] = label; };
  // Animations live in a parallel `anim` map (keyed by param key), NOT in `params`.
  const scan = (animMap) => {
    for (const [key, a] of Object.entries(animMap || {})) {
      if (a && a.mode === 'dashboard') note(a.link, prettyParam(key));
    }
  };
  const comp = show?.composition || {};
  scan(comp.anim);
  for (const layer of comp.layers || []) {
    scan(layer.anim);
    for (const clip of layer.clips || []) scan(clip.anim);
  }
  for (const f of show?.fixtures || []) {
    for (const ref of Object.values(f.input?.dmx?.bind || {})) {
      if (typeof ref === 'string' && ref.startsWith('dash:')) note(ref.slice(5), f.name || f.id || 'DMX');
    }
  }
  return labels;
}
