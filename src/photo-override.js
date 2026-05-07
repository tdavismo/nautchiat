// Photo override: modal that lets the user replace a species photo
// from a fresh iNaturalist search or by uploading a local file.
//
// Persists as a Blob in IndexedDB, keyed by species_id. App boot merges
// these over `species.json` so the rest of the UI is unaware.

import {
  getPhotoOverride, putPhotoOverride, removePhotoOverride,
} from './store.js';

// ---------------------------------------------------------------
// DOM helper
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
// iNaturalist refetch
// ---------------------------------------------------------------

// Accept all CC variants — this app is personal non-commercial use.
const ACCEPTED_LICENSES = new Set([
  'cc-by', 'cc-by-sa', 'cc-by-nd',
  'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nc-nd',
  'cc0',
]);
const PER_PAGE = 20;

// Walks up to MAX_PAGES of observations starting from globalAttempt,
// returning the first result with a downloadable CC-licensed photo.
// Returns null (not throws) on total failure so caller can fall back.
async function fetchFromObservations(taxonName, attempt) {
  for (let pageOffset = 0; pageOffset < 3; pageOffset++) {
    const globalAttempt = attempt + pageOffset * PER_PAGE;
    const page = Math.floor(globalAttempt / PER_PAGE) + 1;
    const url =
      `https://api.inaturalist.org/v1/observations` +
      `?taxon_name=${encodeURIComponent(taxonName)}` +
      `&quality_grade=research&per_page=${PER_PAGE}&page=${page}` +
      `&order_by=votes&order=desc`;
    let data;
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      data = await resp.json();
    } catch { continue; }
    const results = data.results || [];
    if (!results.length) break;

    const startIndex = globalAttempt % PER_PAGE;
    for (let i = 0; i < results.length; i++) {
      const idx = (startIndex + i) % results.length;
      const obs = results[idx];
      const photo = obs.photos?.[0];
      if (!photo || !ACCEPTED_LICENSES.has(photo.license_code)) continue;
      const photoUrl = photo.url.replace('/square.', '/medium.');
      try {
        const blob = await fetch(photoUrl).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.blob();
        });
        return {
          blob, mime: blob.type || 'image/jpeg',
          attribution: photo.attribution,
          license: humanizeLicense(photo.license_code),
          photo_id: String(photo.id),
          observation_id: String(obs.id),
          attempt: globalAttempt,
        };
      } catch { continue; } // blob fetch failed; try next photo
    }
  }
  return null;
}

// Falls back to the taxon's default photo via the taxa endpoint.
// That endpoint was used to populate the initial corpus and is reliable.
async function fetchFromTaxa(taxonName, attempt) {
  let data;
  try {
    const resp = await fetch(
      `https://api.inaturalist.org/v1/taxa` +
      `?q=${encodeURIComponent(taxonName)}&rank=species&per_page=5`
    );
    if (!resp.ok) return null;
    data = await resp.json();
  } catch { return null; }

  const taxon =
    data.results?.find((t) => t.name.toLowerCase() === taxonName.toLowerCase()) ||
    data.results?.[0];
  if (!taxon?.default_photo) return null;

  const photo = taxon.default_photo;
  const photoUrl = photo.medium_url || photo.url?.replace('/square.', '/medium.');
  if (!photoUrl) return null;

  try {
    const blob = await fetch(photoUrl).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.blob();
    });
    return {
      blob, mime: blob.type || 'image/jpeg',
      attribution: photo.attribution || taxon.name,
      license: humanizeLicense(photo.license_code),
      photo_id: String(photo.id || ''),
      observation_id: '',
      attempt,
    };
  } catch { return null; }
}

async function fetchInatNext(species, currentAttempt) {
  const taxonName = species.scientific_name;
  const attempt = currentAttempt + 1;

  const result =
    await fetchFromObservations(taxonName, attempt) ||
    await fetchFromTaxa(taxonName, attempt);

  if (result) return result;
  throw new Error('No CC-licensed photos found for this species on iNaturalist.');
}

function humanizeLicense(code) {
  const map = {
    'cc-by':    'CC BY',
    'cc-by-sa': 'CC BY-SA',
    'cc-by-nc': 'CC BY-NC',
    'cc0':      'CC0',
  };
  return map[code] || code;
}

// ---------------------------------------------------------------
// Modal
// ---------------------------------------------------------------

export async function openPhotoModal(species, opts = {}) {
  const onChanged = opts.onChanged || (() => {});
  const existing = await getPhotoOverride(species.id);

  const overlay = el('div', { class: 'modal-overlay' });
  const modal = el('div', { class: 'modal' });
  overlay.appendChild(modal);

  const status = el('p', { class: 'modal-status' });

  const previewWrap = el('div', { class: 'modal-preview' });
  const previewImg = el('img', {
    class: 'modal-preview-img',
    src: currentPhotoUrl(species),
    alt: species.scientific_name,
  });
  const previewCredit = el('p', { class: 'modal-preview-credit' },
    formatCredit(existing, species),
  );
  previewWrap.append(previewImg, previewCredit);

  const tryAnotherBtn = el('button', { class: 'btn-secondary' }, 'Try another from iNaturalist');
  const uploadBtn = el('button', { class: 'btn-secondary' }, 'Upload from device');
  const fileInput = el('input', {
    type: 'file', accept: 'image/*', style: 'display:none',
  });
  const revertBtn = el('button', {
    class: 'btn-secondary',
    style: existing ? '' : 'display:none',
  }, 'Revert to default');
  const closeBtn = el('button', { class: 'btn-primary' }, 'Done');

  modal.append(
    el('h3', { class: 'modal-title' }, 'Change photo'),
    el('p', { class: 'modal-sub' },
      `${species.common_names.en[0] || species.scientific_name} · `,
      el('em', {}, species.scientific_name),
    ),
    previewWrap,
    status,
    el('div', { class: 'modal-actions' },
      tryAnotherBtn, uploadBtn, revertBtn,
    ),
    el('div', { class: 'modal-footer' }, closeBtn),
    fileInput,
  );

  // ----- handlers -----

  let currentAttempt = existing?.attempt ?? -1;

  tryAnotherBtn.addEventListener('click', async () => {
    setBusy(true, 'Searching iNaturalist…');
    try {
      const result = await fetchInatNext(species, currentAttempt);
      currentAttempt = result.attempt;
      await putPhotoOverride({
        species_id: species.id,
        blob: result.blob,
        mime: result.mime,
        source: 'iNaturalist',
        attribution: result.attribution,
        license: result.license,
        photo_id: result.photo_id,
        observation_id: result.observation_id,
        attempt: result.attempt,
        added_at: Date.now(),
      });
      const blobUrl = URL.createObjectURL(result.blob);
      previewImg.src = blobUrl;
      previewCredit.textContent = `${result.attribution} · iNaturalist`;
      revertBtn.style.display = '';
      setBusy(false, 'Saved.');
      onChanged();
    } catch (err) {
      console.error(err);
      setBusy(false, `Couldn't fetch: ${err.message}`);
    }
  });

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true, 'Saving upload…');
    try {
      await putPhotoOverride({
        species_id: species.id,
        blob: file,
        mime: file.type || 'image/jpeg',
        source: 'upload',
        attribution: 'User upload',
        license: null,
        photo_id: '',
        observation_id: '',
        attempt: 0,
        added_at: Date.now(),
      });
      const blobUrl = URL.createObjectURL(file);
      previewImg.src = blobUrl;
      previewCredit.textContent = 'User upload';
      revertBtn.style.display = '';
      setBusy(false, 'Saved.');
      onChanged();
    } catch (err) {
      console.error(err);
      setBusy(false, `Couldn't save: ${err.message}`);
    }
    fileInput.value = '';
  });

  revertBtn.addEventListener('click', async () => {
    setBusy(true, 'Reverting…');
    try {
      await removePhotoOverride(species.id);
      const original = species.photos?.find((p) => !p.is_override) || species.photos?.[0];
      previewImg.src = original?.url || '';
      previewCredit.textContent = original ? `${original.attribution} · ${original.source}` : '';
      revertBtn.style.display = 'none';
      currentAttempt = -1;
      setBusy(false, 'Reverted to default.');
      onChanged();
    } catch (err) {
      console.error(err);
      setBusy(false, `Couldn't revert: ${err.message}`);
    }
  });

  closeBtn.addEventListener('click', () => closeModal());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', escClose);

  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    overlay.remove();
    document.removeEventListener('keydown', escClose);
  }
  function setBusy(busy, message) {
    [tryAnotherBtn, uploadBtn, revertBtn].forEach((b) => { b.disabled = busy; });
    status.textContent = message || '';
    status.className = 'modal-status' + (busy ? ' busy' : '');
  }

  document.body.appendChild(overlay);
}

function currentPhotoUrl(species) {
  return species.photos?.[0]?.url || '';
}

function formatCredit(override, species) {
  if (override) {
    return `${override.attribution} · ${override.source}`;
  }
  const p = species.photos?.[0];
  if (!p) return '';
  return `${p.attribution} · ${p.source}`;
}

// ---------------------------------------------------------------
// App-boot helper: merges overrides over species.photos[0].
// Returns a list of object-URL strings that the caller can revoke later.
// ---------------------------------------------------------------

export async function mergePhotoOverrides(speciesList, overridesById) {
  const objectUrls = [];
  for (const s of speciesList) {
    const o = overridesById[s.id];
    if (!o || !o.blob) continue;
    const url = URL.createObjectURL(o.blob);
    objectUrls.push(url);
    const overridePhoto = {
      url,
      license: o.license || '',
      attribution: o.attribution || '',
      source: o.source,
      photo_id: o.photo_id || '',
      is_override: true,
    };
    s.photos = [overridePhoto, ...(s.photos || [])];
  }
  return objectUrls;
}
