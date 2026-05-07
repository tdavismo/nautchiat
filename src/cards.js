// Card generation: each species → 0..N cards depending on which name
// fields are populated and whether a photo exists.
//
// face = { kind: 'sci' | 'en' | 'sig', text, label }            // text face
//      | { kind: 'photo', url, label }                          // photo face
//      | { kind: 'photo-choice', label }                        // MC photo grid
//                                                                 (distractors picked at render time)
//
// Card directions generated per species:
//   sci ↔ en           (always — every species has both)
//   en  ↔ sig          (only if siglitun present)
//   sig → sci          (only if siglitun present)
//   photo → en         (only if photo present)
//   photo → sci        (only if photo present)
//   photo → sig        (only if photo present and siglitun present)
//   en   → photo-mc    (only if photo present)
//   sci  → photo-mc    (only if photo present)
//   sig  → photo-mc    (only if photo present and siglitun present)

const FACE_LABELS = {
  sci:   'Scientific',
  en:    'English',
  sig:   'Siglitun',
  photo: 'Photo',
};

const PHOTO_PROMPT_LABELS = {
  en:  'What is this?',
  sci: 'Scientific name?',
  sig: 'Siglitun name?',
};

function textFace(kind, text) {
  return { kind, text, label: FACE_LABELS[kind] };
}

function photoFace(url) {
  return { kind: 'photo', url, label: FACE_LABELS.photo };
}

function photoChoiceFace() {
  return { kind: 'photo-choice', label: FACE_LABELS.photo };
}

function makeCard(species, type, prompt, answer) {
  return {
    id: `${species.id}::${type}`,
    species_id: species.id,
    family: species.family,
    type,
    prompt,
    answer,
    // Photo URL used for the card's blurred backdrop on text-prompt cards.
    // Photo-prompt cards expose this too but the renderer skips the backdrop.
    photo_url: species.photos?.[0]?.url ?? null,
    // Pre-computed friendly prompt label for photo-prompt cards.
    prompt_instruction: prompt.kind === 'photo'
      ? PHOTO_PROMPT_LABELS[answer.kind]
      : null,
  };
}

export function generateCardsForSpecies(species) {
  const cards = [];
  const en  = species.common_names.en?.[0];
  const sci = species.scientific_name;
  const sig = species.common_names.inuvialuktun?.siglitun?.[0];
  const photoUrl = species.photos?.[0]?.url;

  if (sci && en) {
    cards.push(makeCard(species, 'sci-en', textFace('sci', sci), textFace('en', en)));
    cards.push(makeCard(species, 'en-sci', textFace('en', en), textFace('sci', sci)));
  }
  if (en && sig) {
    cards.push(makeCard(species, 'en-sig', textFace('en', en), textFace('sig', sig)));
    cards.push(makeCard(species, 'sig-en', textFace('sig', sig), textFace('en', en)));
  }
  if (sci && sig) {
    cards.push(makeCard(species, 'sig-sci', textFace('sig', sig), textFace('sci', sci)));
  }

  // Photo-recognition cards (free-recall: photo → name)
  if (photoUrl) {
    if (en)  cards.push(makeCard(species, 'photo-en',  photoFace(photoUrl), textFace('en', en)));
    if (sci) cards.push(makeCard(species, 'photo-sci', photoFace(photoUrl), textFace('sci', sci)));
    if (sig) cards.push(makeCard(species, 'photo-sig', photoFace(photoUrl), textFace('sig', sig)));

    // Multiple-choice cards (name → 4-photo grid; distractors selected at render time)
    if (en)  cards.push(makeCard(species, 'mc-en',  textFace('en', en),  photoChoiceFace()));
    if (sci) cards.push(makeCard(species, 'mc-sci', textFace('sci', sci), photoChoiceFace()));
    if (sig) cards.push(makeCard(species, 'mc-sig', textFace('sig', sig), photoChoiceFace()));
  }

  return cards;
}

export function generateAllCards(speciesList, enabledTypes = null) {
  const cards = speciesList.flatMap(generateCardsForSpecies);
  if (!enabledTypes) return cards;
  return cards.filter((c) => enabledTypes.has(c.type));
}

export const ALL_CARD_TYPE_IDS = [
  'sci-en', 'en-sci',
  'en-sig', 'sig-en', 'sig-sci',
  'photo-en', 'photo-sci', 'photo-sig',
  'mc-en', 'mc-sci', 'mc-sig',
];
