# Data schema

Two files form the corpus: `sources.json` (citations, keyed by `ref_id`) and `species.json` (an array of species records). Citations live at the species level only — they are not attached to individual fields or names.

## sources.json

Map of `ref_id` → source record.

```json
{
  "bandringa-2010": {
    "type": "book",
    "authors": ["Bandringa, Robert W."],
    "year": 2010,
    "title": "Inuvialuit Nautchiangit: Relationships between people and plants",
    "publisher": "Inuvialuit Cultural Resource Centre & Parks Canada",
    "place": "Inuvik, NWT",
    "abbreviation": "Bandringa 2010"
  }
}
```

## species.json

Array of species records.

```json
{
  "id": "rubus-chamaemorus",
  "scientific_name": "Rubus chamaemorus",
  "family": "Rosaceae",
  "tier": 1,
  "fruit_bearing": true,

  "common_names": {
    "en": ["cloudberry", "bakeapple"],
    "inuvialuktun": {
      "siglitun":         ["aqpik"],
      "uummarmiutun":     [],
      "kangiryuarmiutun": []
    }
  },

  "growth_form": "Low herbaceous perennial, 5–20 cm tall.",
  "habitat": "Sphagnum bogs, tussock tundra, wet peaty ground.",
  "distinguishing_features": "Lobed maple-like leaves; solitary white flower; fruit ripens red to amber-gold.",
  "cultural_notes": null,

  "photos": [
    {
      "url": "https://inaturalist-open-data.s3.amazonaws.com/photos/67069629/medium.jpg",
      "license": "CC BY-NC",
      "attribution": "(c) vladimir_korotkov, some rights reserved (CC BY-NC), uploaded by vladimir_korotkov",
      "source": "iNaturalist",
      "photo_id": "67069629"
    }
  ],

  "audio_url": null,

  "sources": ["porsild-cody-1980"]
}
```

### Field rules

- **`id`** — kebab-case slug from scientific name. Stable; never change.
- **`scientific_name`** — current accepted binomial.
- **`family`** — controls the visual swatch color via the family palette in `styles.css`.
- **`tier`** — `1` fruit-bearing of cultural importance · `2` other common species in tier-1 families · `3` habitat companions.
- **`common_names.en`** — array of strings. First entry is the headline.
- **`common_names.inuvialuktun.{dialect}`** — array of strings. **Empty array** = no name recorded for that dialect. **A name in this array is assumed verified by the curator** against an authoritative source (Bandringa 2010, ICRC, or a community speaker). Don't add unverified placeholders to committed data.
- **`growth_form` / `habitat` / `distinguishing_features`** — short prose, sentence case, sourced from a botanical reference listed in `sources`. Optional (any field can be `null`; UI hides absent fields).
- **`cultural_notes`** — short prose. **Leave `null` unless the content is verified against `Bandringa 2010` or a comparable community-validated source.** No general-knowledge placeholders.
- **`photos`** — array of photo records. Empty array allowed; UI falls back to family-palette swatch.
- **`audio_url`** — always `null` in v1.
- **`sources`** — array of `ref_id` strings backing the textual fields. Photo records carry their own `attribution` and don't need to appear here.

### Photo records

```json
{
  "url": "...",                 // direct URL to the photo image (e.g. medium.jpg)
  "license": "CC BY-NC",        // human-readable license tag
  "attribution": "...",         // verbatim attribution string from the source
  "source": "iNaturalist",      // platform the photo came from
  "photo_id": "67069629"        // platform-specific photo identifier (for traceability)
}
```

License policy: any Creative Commons license (CC BY, CC BY-SA, CC BY-NC, CC BY-NC-SA, CC0). Plain "all rights reserved" photos are NOT permitted in committed data, even from public web sources, because we display them in the UI and republish via attribution.

### Sample data caveats

- The Inuvialuktun names presently shipped (`aqpik`, `paunġaq`, `kimmiŋnaq`) are **placeholder spellings for diacritic-rendering testing only**. They have not been cross-checked against Bandringa 2010 or ICRC. Replace or remove them once verified.
- All `cultural_notes` fields are currently `null`. Populate them as you cross-check Bandringa, citing it in `sources`.

## File layout

```
data/
  schema.md          ← this file
  sources.json       ← keyed map of references
  species.json       ← array of species records
```
