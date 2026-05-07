// Study view — review loop with FSRS scheduling and grade buttons.

import { generateAllCards } from './cards.js';
import { scheduleReview, projectIntervals } from './fsrs.js';
import {
  getAllReviews, putReview, logReview,
  getStreak, tickStreak, ymd,
  getDayIntroBonus, setMeta,
} from './store.js';
import { getSettings } from './settings.js';

const DAY_MS = 86_400_000;

const GRADES = [
  { g: 1, label: 'Again', cls: 'again' },
  { g: 2, label: 'Hard',  cls: 'hard'  },
  { g: 3, label: 'Good',  cls: 'good'  },
  { g: 4, label: 'Easy',  cls: 'easy'  },
];

let session = null;

// ---------------------------------------------------------------
// DOM helpers (mirrors app.js — kept local to avoid coupling)
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

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fmtInterval(ms) {
  if (ms < 0) ms = 0;
  if (ms < DAY_MS) {
    const hours = Math.round(ms / 3_600_000);
    return hours < 1 ? '<1h' : `${hours}h`;
  }
  const days = ms / DAY_MS;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

// ---------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------

async function buildSession(speciesList) {
  const settings = await getSettings();
  const enabledTypes = new Set(
    Object.entries(settings.enabledCardTypes).filter(([, v]) => v).map(([k]) => k)
  );
  const allCards = generateAllCards(speciesList, enabledTypes);
  const reviews = await getAllReviews();
  const reviewByCard = Object.fromEntries(reviews.map((r) => [r.card_id, r]));

  const now = Date.now();
  const today = ymd(now);

  const introducedToday = reviews.filter((r) =>
    r.reps === 1 && ymd(r.last_review) === today
  ).length;
  const dayBonus = await getDayIntroBonus(now);
  const newSlots = Math.max(0, settings.newCardsPerDay - introducedToday + dayBonus);

  const due = [];
  const fresh = [];
  for (const card of allCards) {
    const rec = reviewByCard[card.id];
    if (!rec) {
      fresh.push({ card, review: null });
    } else if (rec.due <= now) {
      due.push({ card, review: rec });
    }
  }

  due.sort((a, b) => a.review.due - b.review.due);
  shuffle(fresh);
  const freshLimited = fresh.slice(0, newSlots);

  return {
    queue: [...due, ...freshLimited],
    completed: 0,
    again: 0,
    revealed: false,
    totalCards: allCards.length,
    introducedToday,
    newSlotsToday: newSlots,
    settings,
    mcChoices: null,
    mcSelected: null,
  };
}

function generateMcChoices(card, speciesPool) {
  const correct = speciesPool.find((s) => s.id === card.species_id);
  if (!correct) return [];
  const candidates = speciesPool.filter((s) => s.id !== correct.id && s.photos?.[0]?.url);

  const sameFamily = shuffle(candidates.filter((s) => s.family === card.family));
  const otherFamily = shuffle(candidates.filter((s) => s.family !== card.family));

  const distractors = [];
  while (distractors.length < 3 && sameFamily.length) distractors.push(sameFamily.shift());
  while (distractors.length < 3 && otherFamily.length) distractors.push(otherFamily.shift());

  return shuffle([
    { species: correct, correct: true },
    ...distractors.map((s) => ({ species: s, correct: false })),
  ]);
}

// ---------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------

export async function renderStudy(mountNode, speciesList) {
  if (!session || session.speciesRef !== speciesList) {
    session = await buildSession(speciesList);
    session.speciesRef = speciesList;
  }
  paint(mountNode);
}

export function clearSession() {
  session = null;
}

// ---------------------------------------------------------------
// Painting
// ---------------------------------------------------------------

async function paint(mount) {
  const streak = await getStreak();

  if (!session.queue.length) {
    mount.replaceChildren(emptyState(streak));
    return;
  }

  const { card, review } = session.queue[0];

  const isPhotoPrompt = card.prompt.kind === 'photo';
  const isMc = card.answer.kind === 'photo-choice';
  const mcSelected = isMc ? session.mcSelected : null;

  if (isMc && !session.mcChoices) {
    session.mcChoices = generateMcChoices(card, session.speciesRef);
  }

  const header = el('div', { class: 'study-header' },
    el('div', { class: 'study-progress' },
      el('div', { class: 'progress-row' },
        el('span', { class: 'count' }, `${session.completed} reviewed`),
        el('span', { class: 'sep' }, '·'),
        el('span', { class: 'count' }, `${session.queue.length} in queue`),
      ),
      el('div', { class: 'progress-sub' },
        `${session.totalCards} cards in deck · ${session.settings.newCardsPerDay}/day cap`,
      ),
    ),
    el('div', { class: 'study-streak', title: 'Day streak' },
      el('span', { class: 'streak-icon', 'aria-hidden': 'true' }),
      el('span', {}, `${streak.count}`),
    ),
  );

  const promptLabel = el('div', { class: 'face-label' },
    isPhotoPrompt ? card.prompt_instruction : card.prompt.label
  );
  const promptFace = isPhotoPrompt
    ? el('img', {
        class: 'face-photo',
        src: card.prompt.url,
        alt: '',
        loading: 'eager',
      })
    : el('div', {
        class: 'face-text prompt',
        'data-kind': card.prompt.kind,
      }, card.prompt.text);

  // Backdrop only on text-prompt non-MC cards. Photo-prompt cards already
  // have the photo as the foreground; MC cards would leak the answer.
  const useBackdrop = !isPhotoPrompt && !isMc && card.photo_url;

  const body = el('div', {
    class: 'study-card',
    'data-family': card.family,
    'data-bg': useBackdrop ? '1' : null,
    style: useBackdrop ? `--bg-photo: url("${card.photo_url}")` : null,
  }, promptLabel, promptFace);

  if (isMc) {
    body.appendChild(renderMcGrid(card, mount));
    if (mcSelected) {
      body.appendChild(el('div', {
        class: `mc-feedback ${mcSelected.correct ? 'right' : 'wrong'}`,
      }, mcSelected.correct ? 'Correct' : 'Not quite — that was the right one.'));
    }
  } else if (session.revealed) {
    body.appendChild(el('div', { class: 'face-divider' }));
    body.appendChild(el('div', { class: 'face-label answer' }, card.answer.label));
    body.appendChild(el('div', {
      class: 'face-text answer',
      'data-kind': card.answer.kind,
    }, card.answer.text));
  }

  let footer = null;
  if (isMc && mcSelected) {
    footer = gradeRow(card, review);
  } else if (!isMc && session.revealed) {
    footer = gradeRow(card, review);
  } else if (!isMc) {
    footer = el('div', { class: 'study-actions' },
      el('button', {
        class: 'btn-primary',
        onclick: () => { session.revealed = true; paint(mount); },
      }, 'Show answer'),
      el('div', { class: 'kbd-hint' }, 'space'),
    );
  }
  // MC card before tap: no footer; the grid is the action.

  const children = [header, body];
  if (footer) children.push(footer);
  mount.replaceChildren(...children);
}

function renderMcGrid(card, mount) {
  const choices = session.mcChoices || [];
  const sel = session.mcSelected;

  return el('div', { class: 'mc-grid', role: 'group', 'aria-label': 'Choose the matching photo' },
    ...choices.map((c, i) => {
      const photo = c.species.photos?.[0];
      if (!photo) return null;
      const cls = ['mc-thumb'];
      if (sel) {
        if (c.correct) cls.push('is-correct');
        else if (i === sel.index) cls.push('is-wrong');
        else cls.push('is-faded');
      }
      return el('button', {
        class: cls.join(' '),
        type: 'button',
        disabled: !!sel,
        'aria-label': `Choice ${i + 1}`,
        onclick: sel ? null : () => onMcTap(i, mount),
      },
        el('img', { src: photo.url, alt: '', loading: 'eager' }),
      );
    }).filter(Boolean),
  );
}

function onMcTap(index, mount) {
  const choice = session.mcChoices?.[index];
  if (!choice) return;
  session.mcSelected = { index, correct: choice.correct };
  paint(mount);
}

function gradeRow(card, review) {
  const projections = projectIntervals(review, Date.now(), session.settings.targetRetention);
  return el('div', { class: 'grade-row' },
    ...GRADES.map(({ g, label, cls }) =>
      el('button', {
        class: `grade-btn ${cls}`,
        onclick: () => onGrade(g),
      },
        el('span', { class: 'grade-label' }, label),
        el('span', { class: 'grade-interval' }, fmtInterval(projections[g])),
        el('span', { class: 'kbd-hint' }, String(g)),
      ),
    ),
  );
}

function emptyState(streak) {
  return el('div', { class: 'study-empty' },
    el('div', { class: 'study-empty-icon', 'aria-hidden': 'true' }),
    el('h2', {}, 'All caught up'),
    el('p', {}, 'Nothing else due right now. Add more new cards for today, or come back tomorrow.'),
    el('div', { class: 'study-streak big', title: 'Day streak' },
      el('span', { class: 'streak-icon', 'aria-hidden': 'true' }),
      el('span', {}, `${streak.count}-day streak`),
    ),
    el('div', { class: 'empty-actions' },
      el('button', {
        class: 'btn-primary',
        onclick: async () => {
          const speciesRef = session?.speciesRef ?? [];
          const cap = session?.settings?.newCardsPerDay ?? 5;
          const today = ymd(Date.now());
          const cur = await getDayIntroBonus();
          await setMeta('day_intro_bonus', { date: today, bonus: cur + cap });
          clearSession();
          renderStudy(document.getElementById('view'), speciesRef);
        },
      }, 'Add more cards today'),
      el('a', { class: 'btn-secondary link', href: '#/' }, 'Browse species'),
    ),
  );
}

// ---------------------------------------------------------------
// Grading
// ---------------------------------------------------------------

async function onGrade(grade) {
  if (!session?.queue.length) return;
  const item = session.queue.shift();
  const now = Date.now();

  const next = scheduleReview(item.review, grade, now, session.settings.targetRetention);
  const record = { card_id: item.card.id, ...next };

  await putReview(record);
  await logReview({
    card_id: item.card.id,
    species_id: item.card.species_id,
    grade,
    at: now,
    day: ymd(now),
  });
  await tickStreak(now);

  session.completed += 1;
  if (grade === 1) session.again += 1;
  session.revealed = false;
  session.mcChoices = null;
  session.mcSelected = null;

  // If user pressed Again, requeue the card to the back so it's seen
  // again this session.
  if (grade === 1) {
    session.queue.push({ card: item.card, review: record });
  }

  paint(document.getElementById('view'));
}

// ---------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (!session || !document.querySelector('.study-card, .study-empty')) return;
  if (e.target.matches('input, textarea')) return;

  const item = session.queue?.[0];
  if (!item) return;
  const isMc = item.card.answer.kind === 'photo-choice';
  const view = document.getElementById('view');

  if (e.code === 'Space') {
    if (!isMc && !session.revealed) {
      e.preventDefault();
      session.revealed = true;
      paint(view);
    }
    return;
  }

  if (/^[1-4]$/.test(e.key)) {
    if (isMc && !session.mcSelected) {
      e.preventDefault();
      onMcTap(Number(e.key) - 1, view);
    } else if ((isMc && session.mcSelected) || (!isMc && session.revealed)) {
      e.preventDefault();
      onGrade(Number(e.key));
    }
  }
});
