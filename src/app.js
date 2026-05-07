// Nautchiat — flora of the ISR
// Plain ES module, no build step.

import { renderStudy, clearSession } from './study.js';
import { renderSettings, getSettings, applyTheme } from './settings.js';
import { getAllPhotoOverrides, getExtraSpecies } from './store.js';
import { mergePhotoOverrides, openPhotoModal } from './photo-override.js';

const view = document.getElementById('view');

const state = {
  species: [],
  sources: {},
  filter: { tier: 'all', fruitOnly: false },
  // Track object URLs created from photo overrides so they can be revoked
  // when the corpus reloads.
  overrideObjectUrls: [],
};

// ---------------------------------------------------------------
// Load corpus + apply photo overrides + apply theme
// ---------------------------------------------------------------

async function loadData() {
  const [species, sources, overrides, extraSpecies, settings] = await Promise.all([
    fetch('data/species.json').then((r) => r.json()),
    fetch('data/sources.json').then((r) => r.json()),
    getAllPhotoOverrides(),
    getExtraSpecies(),
    getSettings(),
  ]);
  // Extra species supplement species.json; IDs already in the file are skipped.
  const existingIds = new Set(species.map((s) => s.id));
  const merged = [...species, ...extraSpecies.filter((s) => !existingIds.has(s.id))];
  state.overrideObjectUrls.forEach((u) => URL.revokeObjectURL(u));
  state.overrideObjectUrls = await mergePhotoOverrides(merged, overrides);
  state.species = merged;
  state.sources = sources;
  applyTheme(settings.theme);
}

async function reloadCorpus() {
  await loadData();
  clearSession();
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function primarySiglitun(species) {
  const arr = species.common_names?.inuvialuktun?.siglitun || [];
  return arr[0] || null;
}

function filteredSpecies() {
  return state.species.filter((s) => {
    if (state.filter.fruitOnly && !s.fruit_bearing) return false;
    if (state.filter.tier !== 'all' && s.tier !== state.filter.tier) return false;
    return true;
  });
}

// ---------------------------------------------------------------
// Browse view
// ---------------------------------------------------------------

function renderBrowse() {
  const list = filteredSpecies();

  const head = el('div', { class: 'section-head' },
    el('h2', {}, 'Species'),
    el('span', { class: 'count' }, `${list.length} of ${state.species.length}`),
  );

  const filters = el('div', { class: 'filterbar' },
    tierChip('all', 'All'),
    tierChip(1, 'Tier 1'),
    tierChip(2, 'Tier 2'),
    tierChip(3, 'Tier 3'),
    el('button', {
      class: `chip ${state.filter.fruitOnly ? 'on' : ''}`,
      onclick: () => { state.filter.fruitOnly = !state.filter.fruitOnly; renderBrowse(); },
    }, 'Fruit-bearing only'),
  );

  const ul = el('ul', { class: 'species-list' },
    ...list.map(speciesCard),
  );

  view.replaceChildren(head, filters, ul);
  setActiveNav('browse');
}

function tierChip(value, label) {
  const on = state.filter.tier === value;
  return el('button', {
    class: `chip ${on ? 'on' : ''}`,
    onclick: () => { state.filter.tier = value; renderBrowse(); },
  }, label);
}

function speciesCard(s) {
  const en = s.common_names.en[0] || s.scientific_name;
  const sig = primarySiglitun(s);

  const ivBlock = sig
    ? el('div', { class: 'species-iv' },
        el('span', {}, sig),
        el('span', { class: 'dialect' }, 'Siglitun'),
      )
    : el('div', { class: 'species-iv-empty' }, 'name not yet recorded');

  const tierClass = `tier t${s.tier}`;
  const photo = s.photos?.[0];

  return el('li', {},
    el('a', {
      class: 'species-card',
      href: `#/species/${s.id}`,
      'data-family': s.family,
    },
      photo
        ? el('img', {
            class: 'species-photo',
            src: photo.url,
            alt: s.scientific_name,
            loading: 'lazy',
          })
        : el('div', { class: 'species-photo' }),
      el('div', { class: 'species-body' },
        el('div', { class: 'species-en' }, en),
        el('div', { class: 'species-sci' }, s.scientific_name),
        ivBlock,
        el('div', { class: 'species-meta' },
          el('span', { class: tierClass }, `Tier ${s.tier}`),
          el('span', {}, s.family),
          s.fruit_bearing && el('span', {}, 'Fruit'),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------

function renderDetail(id) {
  const s = state.species.find((x) => x.id === id);
  if (!s) {
    view.replaceChildren(el('div', { class: 'loading' }, 'Species not found.'));
    return;
  }

  const en = s.common_names.en[0] || s.scientific_name;

  const back = el('a', { class: 'detail-back', href: '#/' }, '← All species');

  const photo = s.photos?.[0];
  const heroEl = photo
    ? el('img', {
        class: 'detail-hero',
        src: photo.url,
        alt: s.scientific_name,
      })
    : el('div', { class: 'detail-hero' });

  const credit = photo
    ? el('p', { class: 'photo-credit' },
        `${photo.attribution} · ${photo.source}`,
        photo.is_override ? el('span', { class: 'photo-override-tag' }, ' · custom') : null,
        ' · ',
        el('button', {
          class: 'photo-change',
          onclick: () => openPhotoModal(s, {
            onChanged: async () => {
              await reloadCorpus();
              renderDetail(s.id);
            },
          }),
        }, 'change'),
      )
    : el('p', { class: 'photo-credit' },
        el('button', {
          class: 'photo-change',
          onclick: () => openPhotoModal(s, {
            onChanged: async () => {
              await reloadCorpus();
              renderDetail(s.id);
            },
          }),
        }, 'add a photo'),
      );

  const wrapper = el('div', { 'data-family': s.family },
    heroEl,
    credit,

    el('div', { class: 'detail-titles' },
      el('h1', { class: 'detail-en' }, en),
      el('div', { class: 'detail-sci' }, s.scientific_name),
    ),

    renderNames(s),
    ...renderFields(s),
    renderSources(s),
  );

  view.replaceChildren(back, wrapper);
  setActiveNav(null);
}

function renderNames(s) {
  const block = el('div', { class: 'names-block' });
  block.appendChild(el('h3', {}, 'Names'));

  // English
  const enArr = s.common_names.en || [];
  if (enArr.length) {
    block.appendChild(el('div', { class: 'name-row' },
      el('span', { class: 'name', style: 'color: var(--ink)' }, enArr.join(' · ')),
      el('span', { class: 'meta' }, 'English'),
    ));
  }

  // Inuvialuktun by dialect
  const dialects = [
    ['siglitun', 'Siglitun'],
    ['uummarmiutun', 'Uummarmiutun'],
    ['kangiryuarmiutun', 'Kangiryuarmiutun'],
  ];
  let anyIv = false;
  for (const [key, label] of dialects) {
    const arr = s.common_names.inuvialuktun?.[key] || [];
    if (arr.length === 0) continue;
    anyIv = true;
    for (const text of arr) {
      block.appendChild(el('div', { class: 'name-row' },
        el('span', { class: 'name' }, text),
        el('span', { class: 'meta' }, label),
      ));
    }
  }

  if (!anyIv) {
    block.appendChild(el('div', { class: 'name-empty' },
      'No Inuvialuktun name recorded yet for this species.'));
  }

  return block;
}

function renderFields(s) {
  const fields = [
    ['Growth form', s.growth_form],
    ['Habitat', s.habitat],
    ['Distinguishing features', s.distinguishing_features],
    ['Cultural notes', s.cultural_notes],
  ];
  return fields
    .filter(([, body]) => body)
    .map(([label, body]) =>
      el('section', { class: 'field' },
        el('h3', {}, label),
        el('p', {}, body),
      ),
    );
}

function renderSources(s) {
  const refs = s.sources || [];
  if (refs.length === 0) return el('div');

  return el('section', { class: 'sources-list' },
    el('h3', {}, 'Sources'),
    el('ol', {}, ...refs.map((id) => {
      const src = state.sources[id];
      if (!src) return el('li', {}, id);
      const authors = (src.authors || []).join(', ');
      const parts = [
        authors && `${authors} (${src.year}).`,
        src.title && `${src.title}.`,
        src.publisher,
        src.place,
      ].filter(Boolean);
      return el('li', {}, parts.join(' '));
    })),
  );
}

// ---------------------------------------------------------------
// Routing
// ---------------------------------------------------------------

function setActiveNav(routeName) {
  document.querySelectorAll('.topnav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === routeName);
  });
}

function route() {
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\//, '').split('/');

  if (parts[0] === 'species' && parts[1]) {
    clearSession();
    renderDetail(decodeURIComponent(parts[1]));
  } else if (parts[0] === 'study') {
    renderStudy(view, state.species);
    setActiveNav('study');
  } else if (parts[0] === 'settings') {
    clearSession();
    renderSettings(view, {
      onChanged: () => {
        // Settings changes affect study queue + theme. The view is
        // re-painted by settings.js on theme/radio changes.
        clearSession();
      },
    });
    setActiveNav('settings');
  } else {
    clearSession();
    renderBrowse();
  }
}

window.addEventListener('hashchange', route);

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------

view.replaceChildren(el('div', { class: 'loading' }, 'Loading…'));

loadData()
  .then(route)
  .catch((err) => {
    console.error(err);
    view.replaceChildren(el('div', { class: 'loading' },
      'Failed to load corpus. Open the site via a local web server (file:// will block fetch).'));
  });
