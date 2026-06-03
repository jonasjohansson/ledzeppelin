// Fixture CHAINS — an ordered group of fixtures sharing a staggered sample
// offset, so a TRAVELLING source (e.g. Pulse) cascades across the run instead of
// hitting every member at once. This is exactly the Kagora case: 3 strips
// daisy-chained but sitting side-by-side — chain them and a fired pulse arrives
// at member 0, then 1, then 2.
//
// Mechanism (cheap, no per-frame cost): each member m at chain index i gets its
// sample UVs shifted by `i * stagger` along the chain axis, baked once into the
// sampler map at build time (see pipeline.js). Shifting WHERE a fixture samples
// the canvas along the pulse's travel axis is equivalent to a time delay for
// travelling content — member i reads the pulse `i*stagger` of the canvas later.
//
// A fixture belongs to AT MOST one chain. Footprints, pixel counts and DDP
// indices are untouched — only the sampled canvas position shifts.
//
// show.chains: [{ id, name, members: [fixtureId...], stagger, axis: 'x'|'y' }]

const DEFAULT_STAGGER = 0.1;

const chainsOf = (show) => (Array.isArray(show?.chains) ? show.chains : []);

function nextChainId(show) {
  const used = new Set(chainsOf(show).map((c) => c.id));
  let i = 1;
  while (used.has('chain' + i)) i++;
  return 'chain' + i;
}

// Create a chain from an ordered list of fixture ids. Members are removed from
// any other chain first (a fixture is in ≤1 chain). Returns the new show.
export function addChain(show, memberIds, opts = {}) {
  const members = [...new Set(memberIds)].filter(Boolean);
  if (members.length < 2) return show;
  const id = opts.id || nextChainId(show);
  // strip these members out of existing chains, then drop any now-tiny chains
  const existing = chainsOf(show)
    .map((c) => ({ ...c, members: c.members.filter((m) => !members.includes(m)) }))
    .filter((c) => c.members.length >= 2);
  const chain = {
    id,
    name: opts.name || id,
    members,
    stagger: opts.stagger == null ? DEFAULT_STAGGER : Number(opts.stagger),
    axis: opts.axis === 'y' ? 'y' : 'x',
  };
  return { ...show, chains: [...existing, chain] };
}

export function removeChain(show, id) {
  return { ...show, chains: chainsOf(show).filter((c) => c.id !== id) };
}

// Patch a chain (name / stagger / axis / members). Reordering members reorders
// the stagger. Returns the new show.
export function patchChain(show, id, patch) {
  return {
    ...show,
    chains: chainsOf(show).map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, ...patch };
      if (patch.stagger != null) next.stagger = Number(patch.stagger) || 0;
      if (patch.axis) next.axis = patch.axis === 'y' ? 'y' : 'x';
      if (patch.members) next.members = [...new Set(patch.members)].filter(Boolean);
      return next;
    }),
  };
}

// Move a member up/down within its chain (dir -1 = earlier, +1 = later).
export function moveChainMember(show, id, fixtureId, dir) {
  return {
    ...show,
    chains: chainsOf(show).map((c) => {
      if (c.id !== id) return c;
      const members = [...c.members];
      const i = members.indexOf(fixtureId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= members.length) return c;
      [members[i], members[j]] = [members[j], members[i]];
      return { ...c, members };
    }),
  };
}

// The chain containing a fixture, or null.
export function chainOf(show, fixtureId) {
  return chainsOf(show).find((c) => c.members.includes(fixtureId)) || null;
}

// The normalized sample offset [dx, dy] for a fixture (index * stagger along the
// chain axis), or [0, 0] if it is not in a chain.
export function chainOffset(show, fixtureId) {
  for (const c of chainsOf(show)) {
    const idx = c.members.indexOf(fixtureId);
    if (idx >= 0) {
      const s = (Number(c.stagger) || 0) * idx;
      return c.axis === 'y' ? [0, s] : [s, 0];
    }
  }
  return [0, 0];
}

// Drop members that no longer reference a real fixture, and chains left with <2
// members. Call after deleting fixtures so stagger indices stay correct.
export function pruneChains(show) {
  if (!chainsOf(show).length) return show;
  const live = new Set((show.fixtures || []).map((f) => f.id));
  const chains = chainsOf(show)
    .map((c) => ({ ...c, members: c.members.filter((m) => live.has(m)) }))
    .filter((c) => c.members.length >= 2);
  return { ...show, chains };
}
