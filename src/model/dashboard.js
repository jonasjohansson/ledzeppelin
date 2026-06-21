// Global "Dashboard" links — named 0..1 control values that live on the composition
// and can modulate any parameter (clip/layer/composition) and DMX channels, like
// Resolume's Dashboard. Knobs are edited in the Composition tab; values persist in
// the show and are fed into the per-frame `signals` map as `dash:<id>`.

export const DASHBOARD_DEFAULT_LINKS = 8;

export const makeDashboardLink = (i) => ({ id: `d${i + 1}`, name: `Link ${i + 1}`, value: 0 });

// Normalise a composition's dashboard: clean links + pad up to the default count.
export function normDashboard(dash) {
  const links = (Array.isArray(dash?.links) ? dash.links : []).map((l, i) => ({
    id: String(l?.id || `d${i + 1}`),
    name: String(l?.name ?? `Link ${i + 1}`),
    value: Math.max(0, Math.min(1, Number(l?.value) || 0)),
  }));
  while (links.length < DASHBOARD_DEFAULT_LINKS) links.push(makeDashboardLink(links.length));
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
