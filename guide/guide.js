// LED Zeppelin guide viewer — renders the canonical markdown in docs/guide/ as a
// browsable site at /guide/. No build step: the .md files stay the single source and
// are fetched + rendered client-side with the vendored `marked`. Cross-page links
// ("02-concepts.md#anchor") are intercepted and resolved within the viewer.
import { marked } from './marked.esm.js';

// Canonical page list (matches docs/guide/). `slug` is the hash route + nav id.
const PAGES = [
  { file: 'README.md',                     slug: 'home',        title: 'Overview' },
  { file: '01-what-is-led-zeppelin.md',    slug: '01',          title: '1 · What is LED Zeppelin' },
  { file: '02-concepts.md',                slug: '02',          title: '2 · LED control concepts' },
  { file: '03-getting-started.md',         slug: '03',          title: '3 · Getting started' },
  { file: '04-devices-and-scanning.md',    slug: '04',          title: '4 · Devices & scanning' },
  { file: '05-fixtures-and-inventory.md',  slug: '05',          title: '5 · Fixtures & Inventory' },
  { file: '06-canvas-sources-effects.md',  slug: '06',          title: '6 · Canvas: sources & effects' },
  { file: '07-scenes.md',                  slug: '07',          title: '7 · Scenes' },
  { file: '08-mappings.md',                slug: '08',          title: '8 · Mappings' },
  { file: '09-importing-from-ledger.md',   slug: '09',          title: '9 · Importing from LEDger' },
  { file: '10-output-and-calibration.md',  slug: '10',          title: '10 · Output & calibration' },
  { file: '11-deploying.md',               slug: '11',          title: '11 · Deploying the install' },
  { file: '12-troubleshooting.md',         slug: '12',          title: '12 · Troubleshooting & FAQ' },
  { file: '13-glossary.md',                slug: '13',          title: '13 · Glossary & shortcuts' },
];
const byFile = new Map(PAGES.map((p) => [p.file, p]));
const bySlug = new Map(PAGES.map((p) => [p.slug, p]));

const navEl = document.getElementById('g-nav');
const docEl = document.getElementById('g-doc');

// Build the sidebar.
for (const p of PAGES) {
  const a = document.createElement('a');
  a.href = `#${p.slug}`;
  a.textContent = p.title;
  a.dataset.slug = p.slug;
  navEl.append(a);
}

const slugify = (s) => s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

// Parse a location hash like "#02" or "#02&pixels-and-strips" → { slug, anchor }.
function routeFromHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const [slug, anchor] = h.split('&');
  return { slug: bySlug.has(slug) ? slug : 'home', anchor: anchor || '' };
}

let current = null;
async function show(slug, anchor) {
  const page = bySlug.get(slug) || bySlug.get('home');
  if (current !== page.slug) {
    docEl.innerHTML = 'Loading…';
    try {
      const res = await fetch(`./${page.file}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const md = await res.text();
      docEl.innerHTML = marked.parse(md);
      enhance();
      current = page.slug;
      document.title = `LED Zeppelin — ${page.title.replace(/^\d+\s*·\s*/, '')}`;
    } catch (e) {
      docEl.innerHTML = `<p class="g-err">Couldn't load this page (${e.message}). The guide source lives in <code>guide/${page.file}</code>.</p>`;
      current = null;
    }
  }
  // active nav
  for (const a of navEl.querySelectorAll('a')) a.classList.toggle('is-on', a.dataset.slug === page.slug);
  // scroll to anchor or top
  if (anchor) { const t = document.getElementById(anchor); if (t) { t.scrollIntoView(); return; } }
  docEl.parentElement.scrollTop = 0;
}

// Post-render: give headings ids (for anchors) and rewire links.
function enhance() {
  for (const h of docEl.querySelectorAll('h1, h2, h3, h4')) {
    if (!h.id) h.id = slugify(h.textContent);
  }
  for (const a of docEl.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/^https?:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; continue; }
    const [file, anchor] = href.split('#');
    if (file && byFile.has(file)) {
      // Cross-page link to another guide doc → route within the viewer.
      const p = byFile.get(file);
      a.setAttribute('href', `#${p.slug}${anchor ? '&' + anchor : ''}`);
    } else if (!file && anchor) {
      // Same-page anchor → smooth in-page jump.
      a.addEventListener('click', (e) => { e.preventDefault(); const t = document.getElementById(anchor); if (t) t.scrollIntoView(); });
    }
    // (a bare "../something.md" not in our set is left as-is — rare)
  }
}

window.addEventListener('hashchange', () => { const { slug, anchor } = routeFromHash(); show(slug, anchor); });
{ const { slug, anchor } = routeFromHash(); show(slug, anchor); }
