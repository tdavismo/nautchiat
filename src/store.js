// IndexedDB wrapper. Thin and promise-based.
//
// Stores:
//   reviews — keyPath card_id; one record per card with FSRS state
//   history — autoIncrement; one record per individual review event
//   meta    — keyPath key; misc app state (streak, settings)

const DB_NAME = 'nautchiat';
const DB_VERSION = 2;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('reviews')) {
        db.createObjectStore('reviews', { keyPath: 'card_id' });
      }
      if (!db.objectStoreNames.contains('history')) {
        const h = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        h.createIndex('day', 'day');
        h.createIndex('card_id', 'card_id');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('photo_overrides')) {
        db.createObjectStore('photo_overrides', { keyPath: 'species_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

// ---- reviews ----

export async function getReview(cardId) {
  const s = await store('reviews');
  return await wrap(s.get(cardId));
}

export async function getAllReviews() {
  const s = await store('reviews');
  return (await wrap(s.getAll())) || [];
}

export async function putReview(record) {
  const s = await store('reviews', 'readwrite');
  return await wrap(s.put(record));
}

// ---- history ----

export async function logReview(entry) {
  const s = await store('history', 'readwrite');
  return await wrap(s.add(entry));
}

export async function getHistorySince(timestampMs) {
  const s = await store('history');
  const all = await wrap(s.getAll());
  return all.filter((e) => e.at >= timestampMs);
}

// ---- meta ----

export async function getMeta(key) {
  const s = await store('meta');
  const r = await wrap(s.get(key));
  return r ? r.value : null;
}

export async function setMeta(key, value) {
  const s = await store('meta', 'readwrite');
  return await wrap(s.put({ key, value }));
}

// ---- streak helpers ----

export function ymd(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function tickStreak(now = Date.now()) {
  const today = ymd(now);
  const yesterday = ymd(now - 86_400_000);
  const cur = (await getMeta('streak')) || { count: 0, last_active: null };

  if (cur.last_active === today) return cur;

  const next = {
    count: cur.last_active === yesterday ? cur.count + 1 : 1,
    last_active: today,
  };
  await setMeta('streak', next);
  return next;
}

export async function getStreak() {
  return (await getMeta('streak')) || { count: 0, last_active: null };
}

// ---- daily intro bonus (used by "add more cards today") ----

export async function getDayIntroBonus(now = Date.now()) {
  const today = ymd(now);
  const stored = await getMeta('day_intro_bonus');
  if (!stored || stored.date !== today) return 0;
  return stored.bonus || 0;
}

export async function topUpDayIntroBonus(introducedToday, now = Date.now()) {
  const today = ymd(now);
  // Setting bonus = introducedToday makes newSlots = cap right now (no
  // matter how many were already done today). Each call "tops up" to cap.
  await setMeta('day_intro_bonus', { date: today, bonus: introducedToday });
}

// ---- photo overrides ----

export async function getPhotoOverride(speciesId) {
  const s = await store('photo_overrides');
  return await wrap(s.get(speciesId));
}

export async function getAllPhotoOverrides() {
  const s = await store('photo_overrides');
  const arr = (await wrap(s.getAll())) || [];
  return Object.fromEntries(arr.map((o) => [o.species_id, o]));
}

export async function putPhotoOverride(record) {
  const s = await store('photo_overrides', 'readwrite');
  return await wrap(s.put(record));
}

export async function removePhotoOverride(speciesId) {
  const s = await store('photo_overrides', 'readwrite');
  return await wrap(s.delete(speciesId));
}

// ---- bulk reset (preserves settings, photo_overrides) ----

export async function resetSrsProgress() {
  const db = await openDB();
  const tx = db.transaction(['reviews', 'history'], 'readwrite');
  tx.objectStore('reviews').clear();
  tx.objectStore('history').clear();
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  await setMeta('streak', { count: 0, last_active: null });
  await setMeta('day_intro_bonus', null);
}

// ---- export ----

export async function exportAll() {
  const db = await openDB();
  const reviews = await getAllReviews();
  const tx = db.transaction(['history', 'meta'], 'readonly');
  const history = await wrap(tx.objectStore('history').getAll());
  const meta = await wrap(tx.objectStore('meta').getAll());
  // Photo overrides exported as metadata only — Blobs aren't JSON-friendly
  const overrides = Object.values(await getAllPhotoOverrides()).map((o) => ({
    species_id: o.species_id,
    mime: o.mime,
    source: o.source,
    attribution: o.attribution,
    license: o.license,
    added_at: o.added_at,
  }));
  return {
    exported_at: new Date().toISOString(),
    reviews,
    history,
    meta: Object.fromEntries(meta.map((m) => [m.key, m.value])),
    photo_overrides_index: overrides,
  };
}
