# Nautchiat

A personal spaced-repetition tool for learning the flora of the Inuvialuit Settlement Region (NWT, Canada), with a focus on fruit-bearing plants of cultural importance and their Inuvialuktun names. Tundra-zone scope, centered on the Mackenzie Delta and Tuktoyaktuk; boreal-forest species are out of scope.

The name *nautchiat* (in the title bar) is from the Inuvialuktun-language ethnobotany *Inuvialuit Nautchiangit* (Bandringa, 2010), referring loosely to "plants" / "things that grow."

## Status

**Personal-use, in active build. Data is not yet trustworthy enough to redistribute.**

- Plant morphology and habitat fields are sourced from public botanical references and are reasonable for ID; treat them as a starting point, not a definitive flora.
- The three Siglitun names presently in `data/species.json` (`aqpik`, `paunġaq`, `kimmiŋnaq`) are **placeholder spellings for diacritic-rendering testing** and have not been cross-checked against Bandringa 2010 or ICRC. Replace or remove them before treating them as authoritative.
- All `cultural_notes` fields are currently `null` pending Bandringa cross-check.
- Photos are pulled from iNaturalist (default photos and observations) under their respective Creative Commons licenses; attribution is preserved per-photo.

The schema, conventions, and data hygiene rules are in [`data/schema.md`](data/schema.md).

## Run it

No build step. Requires Python 3 (used only as a static file server with correct MIME types for ES modules).

```
python serve.py
```

Then open <http://localhost:8765>. State (review history, settings, photo overrides) persists in your browser's IndexedDB.

The `serve.py` shim exists because Python's built-in `http.server` on Windows mis-maps `.js` to `text/plain`, which causes browsers to refuse to execute ES modules.

## What's in here

- **Browse** — field-guide-style list and detail views for each species, family-keyed color palette
- **Study** — FSRS-4.5 scheduled review loop. Card types per species (depending on which fields are populated): scientific ↔ English, English ↔ Siglitun, Siglitun → scientific, photo → name (free recall), and name → photo (4-photo multiple choice with same-family distractors)
- **Settings** — daily new-card cap, target retention, per-card-type toggles, theme override, day-bonus button (unlock more cards mid-day), data export, full reset
- **Per-species photo override** — replace any species photo from a fresh iNaturalist search or a local upload; stored as a Blob in IndexedDB

## Tech

- Vanilla ES modules, no bundler
- IndexedDB for persistence (reviews, history, settings, photo overrides)
- FSRS-4.5 implemented from scratch in `src/fsrs.js` (~120 lines)
- System fonts only (handles Latin Extended diacritics out of the box on macOS, Windows, iOS, Android)
- Mobile-first CSS, dark by default with a light theme available via system preference or explicit override

## Data sources

- **Bandringa, R.W. (2010).** *Inuvialuit Nautchiangit: Relationships between people and plants.* Inuvialuit Cultural Resource Centre & Parks Canada.
- **Porsild, A.E. & Cody, W.J. (1980).** *Vascular Plants of Continental Northwest Territories, Canada.* National Museum of Natural Sciences.
- **iNaturalist** — for species photos under CC BY, CC BY-SA, CC0, and CC BY-NC licenses.

## License

[MIT](LICENSE) for the code. Photos and any ethnobotanical text excerpts in `data/` carry their own licenses; see individual records.
