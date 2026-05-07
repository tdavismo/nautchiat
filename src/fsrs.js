// FSRS-4.5 scheduler — pure functions.
// Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
//
// Rating values: 1=Again, 2=Hard, 3=Good, 4=Easy.

const W = [
  0.4072, 1.1829, 3.1262, 15.4722,
  7.2102, 0.5316, 1.0651, 0.0234,
  1.616,  0.1544, 1.0824, 1.9813,
  0.0953, 0.2975, 2.2042, 0.2407,
  2.9466, 0.5034, 0.6567,
];

export const DEFAULT_TARGET_RETENTION = 0.9;
const FACTOR = 19 / 81;
const DECAY = -0.5;
const DAY_MS = 86_400_000;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Difficulty for a brand-new card given grade g.
function initDifficulty(g) {
  return clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
}

// Mean reversion of difficulty toward the init-Good baseline.
function meanReversion(current) {
  return clamp(W[7] * initDifficulty(3) + (1 - W[7]) * current, 1, 10);
}

// Difficulty after a review of an existing card.
function nextDifficulty(d, g) {
  return meanReversion(d - W[6] * (g - 3));
}

// Retrievability after `days` since last review, given stability `s`.
function retrievability(days, s) {
  return Math.pow(1 + FACTOR * days / s, DECAY);
}

// Stability after a successful review (g >= 2).
function nextStabilitySuccess(d, s, r, g) {
  const hardPenalty = g === 2 ? W[15] : 1;
  const easyBonus   = g === 4 ? W[16] : 1;
  const factor =
    Math.exp(W[8]) *
    (11 - d) *
    Math.pow(s, -W[9]) *
    (Math.exp(W[10] * (1 - r)) - 1) *
    hardPenalty *
    easyBonus;
  return s * (1 + factor);
}

// Stability after a lapse (g === 1).
function nextStabilityLapse(d, s, r) {
  return W[11] *
    Math.pow(d, -W[12]) *
    (Math.pow(s + 1, W[13]) - 1) *
    Math.exp(W[14] * (1 - r));
}

// Convert stability (days at R=0.9) to interval days at the given target retention.
function intervalDays(s, target = DEFAULT_TARGET_RETENTION) {
  const t = (s / FACTOR) * (Math.pow(target, 1 / DECAY) - 1);
  return Math.max(1, Math.round(t));
}

/**
 * Schedule a card after a review.
 * Returns a NEW review record; does not mutate.
 *
 * card: { state, stability, difficulty, last_review, reps, lapses } | null/new
 * grade: 1..4
 * now: timestamp ms
 */
export function scheduleReview(card, grade, now = Date.now(), target = DEFAULT_TARGET_RETENTION) {
  const g = grade;
  const isFirst = !card || !card.last_review;

  let s, d;
  if (isFirst) {
    s = W[g - 1];
    d = initDifficulty(g);
  } else {
    const elapsedDays = Math.max(0, (now - card.last_review) / DAY_MS);
    const r = retrievability(elapsedDays, card.stability);
    d = nextDifficulty(card.difficulty, g);
    s = g === 1
      ? nextStabilityLapse(card.difficulty, card.stability, r)
      : nextStabilitySuccess(card.difficulty, card.stability, r, g);
  }

  const interval = intervalDays(s, target);
  const due = now + interval * DAY_MS;

  return {
    state: g === 1 ? 'relearning' : 'review',
    stability: s,
    difficulty: d,
    reps: (card?.reps ?? 0) + 1,
    lapses: (card?.lapses ?? 0) + (g === 1 ? 1 : 0),
    last_review: now,
    due,
  };
}

/**
 * Given a card's current review record, project the resulting due-time
 * for each of the four grades. Used by the UI to show "next interval"
 * on each grade button.
 *
 * Returns { 1: ms, 2: ms, 3: ms, 4: ms } — the *interval in ms*, not the due time.
 */
export function projectIntervals(card, now = Date.now(), target = DEFAULT_TARGET_RETENTION) {
  const out = {};
  for (const g of [1, 2, 3, 4]) {
    const next = scheduleReview(card, g, now, target);
    out[g] = next.due - now;
  }
  return out;
}
