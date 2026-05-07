// Settings: storage, defaults, page render, and side-effects (theme, reset).

import { ALL_CARD_TYPE_IDS } from './cards.js';
import {
  getMeta, setMeta,
  resetSrsProgress, exportAll,
  topUpDayIntroBonus, getDayIntroBonus,
  getExtraSpecies, putExtraSpecies, clearExtraSpecies,
} from './store.js';
import { DEFAULT_TARGET_RETENTION } from './fsrs.js';

const TRUE_FOR_ALL_TYPES = Object.fromEntries(ALL_CARD_TYPE_IDS.map((t) => [t, true]));

export const DEFAULT_SETTINGS = {
  newCardsPerDay: 5,
  targetRetention: DEFAULT_TARGET_RETENTION,
  enabledCardTypes: { ...TRUE_FOR_ALL_TYPES },
  theme: 'system', // 'system' | 'dark' | 'light'
};

const CARD_TYPE_GROUPS = [
  {
    label: 'Text recall',
    types: [
      { id: 'sci-en',  name: 'Scientific → English' },
      { id: 'en-sci',  name: 'English → Scientific' },
      { id: 'en-sig',  name: 'English → Siglitun' },
      { id: 'sig-en',  name: 'Siglitun → English' },
      { id: 'sig-sci', name: 'Siglitun → Scientific' },
    ],
  },
  {
    label: 'Photo → name (free recall)',
    types: [
      { id: 'photo-en',  name: 'Photo → English' },
      { id: 'photo-sci', name: 'Photo → Scientific' },
      { id: 'photo-sig', name: 'Photo → Siglitun' },
    ],
  },
  {
    label: 'Name → photo (multiple choice)',
    types: [
      { id: 'mc-en',  name: 'English → photo grid' },
      { id: 'mc-sci', name: 'Scientific → photo grid' },
      { id: 'mc-sig', name: 'Siglitun → photo grid' },
    ],
  },
];

// ---------------------------------------------------------------
// Storage
// ---------------------------------------------------------------

export async function getSettings() {
  const stored = (await getMeta('settings')) || {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    enabledCardTypes: {
      ...DEFAULT_SETTINGS.enabledCardTypes,
      ...(stored.enabledCardTypes || {}),
    },
  };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  if (patch.enabledCardTypes) {
    next.enabledCardTypes = { ...cur.enabledCardTypes, ...patch.enabledCardTypes };
  }
  await setMeta('settings', next);
  if (patch.theme !== undefined) applyTheme(next.theme);
  return next;
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system' || !theme) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

// ---------------------------------------------------------------
// DOM helper (kept local; mirrors app.js)
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

// ---------------------------------------------------------------
// Render
// ---------------------------------------------------------------

export async function renderSettings(mount, opts = {}) {
  const onChanged = opts.onChanged || (() => {});
  const s = await getSettings();
  const dayBonus = await getDayIntroBonus();
  const extraSpecies = await getExtraSpecies();

  const page = el('div', { class: 'settings-page' },
    el('h2', { class: 'settings-title' }, 'Settings'),
  );

  // ----- Daily limits -----
  page.appendChild(section('Daily limits',
    field('New cards per day',
      el('div', { class: 'field-row' },
        el('input', {
          type: 'number',
          min: '0', max: '500', step: '1',
          value: String(s.newCardsPerDay),
          class: 'input-num',
          onchange: async (e) => {
            const v = Math.max(0, Math.min(500, Number(e.target.value) || 0));
            e.target.value = String(v);
            await saveSettings({ newCardsPerDay: v });
            onChanged();
          },
        }),
        el('span', { class: 'field-help' }, 'cards introduced per day'),
      ),
    ),
    field('Add more cards today',
      el('div', { class: 'field-row' },
        el('button', {
          class: 'btn-secondary',
          onclick: async (e) => {
            const current = await getDayIntroBonus();
            // Trigger "top-up": newSlots = cap right now. We set bonus = introducedToday;
            // since we don't know it here, we re-fetch inside study/buildSession to
            // recompute. Simpler heuristic: bump bonus by `cap`.
            await saveSettings({}); // ensure settings exist
            const cap = (await getSettings()).newCardsPerDay;
            const today = ymd(Date.now());
            await setMeta('day_intro_bonus', { date: today, bonus: current + cap });
            e.target.textContent = `Added ${cap} more for today`;
            e.target.disabled = true;
            setTimeout(() => {
              e.target.textContent = 'Add more cards today';
              e.target.disabled = false;
            }, 1600);
            onChanged();
          },
        }, 'Add more cards today'),
        el('span', { class: 'field-help' },
          dayBonus > 0
            ? `+${dayBonus} extra unlocked today`
            : 'unlocks one more cap-worth of new cards (without resetting tomorrow)'
        ),
      ),
    ),
  ));

  // ----- Scheduling -----
  const retentionLabel = el('span', { class: 'slider-value' }, `${(s.targetRetention * 100).toFixed(0)}%`);
  page.appendChild(section('Scheduling',
    field('Target retention',
      el('div', { class: 'field-row' },
        el('input', {
          type: 'range',
          min: '0.70', max: '0.97', step: '0.01',
          value: String(s.targetRetention),
          class: 'input-range',
          oninput: (e) => {
            retentionLabel.textContent = `${(Number(e.target.value) * 100).toFixed(0)}%`;
          },
          onchange: async (e) => {
            await saveSettings({ targetRetention: Number(e.target.value) });
            onChanged();
          },
        }),
        retentionLabel,
      ),
      el('p', { class: 'field-help block' },
        'Higher retention means shorter intervals (more frequent review). 90% is a balanced default; 95%+ greatly increases review load.'
      ),
    ),
  ));

  // ----- Card types -----
  page.appendChild(section('Card types',
    el('p', { class: 'field-help block' },
      'Toggle which directions are generated. Disabling all of a kind reduces the deck size; cards already reviewed retain their schedule but won\'t be re-shown.',
    ),
    ...CARD_TYPE_GROUPS.map((g) => cardTypeGroup(g, s, onChanged)),
  ));

  // ----- Appearance -----
  page.appendChild(section('Appearance',
    field('Theme',
      el('div', { class: 'radio-row' },
        ...['system', 'dark', 'light'].map((opt) =>
          el('label', { class: 'radio-pill' + (s.theme === opt ? ' on' : '') },
            el('input', {
              type: 'radio', name: 'theme', value: opt,
              checked: s.theme === opt,
              onchange: async () => {
                await saveSettings({ theme: opt });
                onChanged();
                // re-render to refresh radio styling
                renderSettings(mount, opts);
              },
            }),
            el('span', {}, opt[0].toUpperCase() + opt.slice(1)),
          ),
        ),
      ),
    ),
  ));

  // ----- Data -----
  const importStatus = el('p', { class: 'field-help block' });
  const importFileInput = el('input', {
    type: 'file', accept: '.json,application/json', style: 'display:none',
  });
  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) parsed = [parsed];
      const valid = parsed.filter(
        (x) => x && typeof x.id === 'string' && typeof x.scientific_name === 'string' && typeof x.family === 'string',
      );
      if (!valid.length) throw new Error('No valid entries found — each needs id, scientific_name, and family.');
      await putExtraSpecies(valid);
      onChanged();
      renderSettings(mount, opts);
    } catch (err) {
      importStatus.textContent = `Import failed: ${err.message}`;
    }
    importFileInput.value = '';
  });

  page.appendChild(section('Data',
    field('Export',
      el('div', { class: 'field-row' },
        el('button', {
          class: 'btn-secondary',
          onclick: async () => {
            const data = await exportAll();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `nautchiat-${ymd(Date.now())}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          },
        }, 'Download data as JSON'),
        el('span', { class: 'field-help' }, 'reviews · history · settings · streak · imported species'),
      ),
    ),
    field('Import species',
      el('div', { class: 'field-row' },
        el('button', {
          class: 'btn-secondary',
          onclick: () => importFileInput.click(),
        }, 'Import from JSON file'),
        extraSpecies.length > 0
          ? el('button', {
              class: 'btn-secondary',
              onclick: async () => {
                if (!confirm(`Remove all ${extraSpecies.length} imported species? This won't affect reviews you've already done.`)) return;
                await clearExtraSpecies();
                onChanged();
                renderSettings(mount, opts);
              },
            }, `Remove ${extraSpecies.length} imported`)
          : null,
        el('span', { class: 'field-help' },
          extraSpecies.length > 0
            ? `${extraSpecies.length} imported species active`
            : 'supplement the built-in corpus; see data/species-template.json',
        ),
        importFileInput,
      ),
      importStatus,
    ),
    field('Reset SRS progress',
      el('div', { class: 'field-row' },
        el('button', {
          class: 'btn-danger',
          onclick: async (e) => {
            if (!confirm('Reset all review history and scheduling? Settings and uploaded photos are preserved. This cannot be undone.')) return;
            await resetSrsProgress();
            e.target.textContent = 'Progress cleared';
            e.target.disabled = true;
            onChanged();
            setTimeout(() => {
              e.target.textContent = 'Reset SRS progress';
              e.target.disabled = false;
            }, 2000);
          },
        }, 'Reset SRS progress'),
        el('span', { class: 'field-help' }, 'wipes reviews, history, streak, day bonus'),
      ),
    ),
  ));

  // ----- Keyboard -----
  page.appendChild(section('Keyboard',
    el('table', { class: 'kbd-table' },
      el('tbody', {},
        kbdRow('Show answer', 'Space'),
        kbdRow('Pick choice / grade', '1 – 4'),
      ),
    ),
  ));

  mount.replaceChildren(page);
}

// ---------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------

function section(title, ...content) {
  return el('section', { class: 'settings-section' },
    el('h3', {}, title),
    ...content,
  );
}

function field(label, ...content) {
  return el('div', { class: 'settings-field' },
    el('label', { class: 'field-label' }, label),
    ...content,
  );
}

function cardTypeGroup(group, settings, onChanged) {
  return el('div', { class: 'cardtype-group' },
    el('div', { class: 'cardtype-group-head' },
      el('span', { class: 'cardtype-group-label' }, group.label),
      el('div', { class: 'cardtype-group-actions' },
        el('button', {
          class: 'link',
          onclick: async () => {
            const patch = Object.fromEntries(group.types.map((t) => [t.id, true]));
            await saveSettings({ enabledCardTypes: patch });
            onChanged();
            // re-render to update checkboxes
            const root = document.querySelector('.settings-page');
            if (root?.parentElement) renderSettings(root.parentElement, { onChanged });
          },
        }, 'all'),
        el('span', { class: 'sep' }, '·'),
        el('button', {
          class: 'link',
          onclick: async () => {
            const patch = Object.fromEntries(group.types.map((t) => [t.id, false]));
            await saveSettings({ enabledCardTypes: patch });
            onChanged();
            const root = document.querySelector('.settings-page');
            if (root?.parentElement) renderSettings(root.parentElement, { onChanged });
          },
        }, 'none'),
      ),
    ),
    el('div', { class: 'cardtype-list' },
      ...group.types.map((t) =>
        el('label', { class: 'cardtype-item' },
          el('input', {
            type: 'checkbox',
            checked: !!settings.enabledCardTypes[t.id],
            onchange: async (e) => {
              await saveSettings({ enabledCardTypes: { [t.id]: e.target.checked } });
              onChanged();
            },
          }),
          el('span', {}, t.name),
        ),
      ),
    ),
  );
}

function kbdRow(label, keys) {
  return el('tr', {},
    el('td', {}, label),
    el('td', {}, el('span', { class: 'kbd-hint' }, keys)),
  );
}

function ymd(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
