export const TITLE_MAX = 200;

/** True only for absolute http(s) URLs. Mirrors the server rule. */
export function isHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** "https://www.youtube.com/watch?v=x" → "youtube.com" */
export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dateFmtYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dateFmtFull = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' });

/** "5 nov." this year, "5 nov. 2025" otherwise. Full date+time for the tooltip. */
export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { short: '', full: '' };
  const short = d.getFullYear() === new Date().getFullYear() ? dateFmt.format(d) : dateFmtYear.format(d);
  return { short, full: dateFmtFull.format(d) };
}

/** Client-side validation (the server validates again). Returns an error message or null. */
export function validateDraft({ title, url }) {
  const t = title.trim();
  if (!t) return 'Le titre est obligatoire.';
  if (t.length > TITLE_MAX) return `Le titre doit faire au plus ${TITLE_MAX} caractères.`;
  if (url.trim() && !isHttpUrl(url)) return 'Le lien doit être une URL http(s) valide.';
  return null;
}

/** Same order as GET /api/items: category order, not-done first, newest first. */
export function sortItems(items, categoryOrder) {
  const rank = new Map(categoryOrder.map((k, i) => [k, i]));
  return [...items].sort(
    (a, b) =>
      (rank.get(a.category) ?? 99) - (rank.get(b.category) ?? 99) ||
      Number(a.done) - Number(b.done) ||
      (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) ||
      b.id - a.id,
  );
}

const LAST_CATEGORY_KEY = 'mnemon.lastCategory';
const LEGACY_LAST_CATEGORY_KEY = 'ideas.lastCategory'; // name used before the app became Mnémon

export function loadLastCategory() {
  try {
    const value = localStorage.getItem(LAST_CATEGORY_KEY);
    if (value !== null) return value;
    // One-time migration from the old key.
    const legacy = localStorage.getItem(LEGACY_LAST_CATEGORY_KEY);
    if (legacy !== null) {
      localStorage.setItem(LAST_CATEGORY_KEY, legacy);
      localStorage.removeItem(LEGACY_LAST_CATEGORY_KEY);
    }
    return legacy;
  } catch {
    return null;
  }
}

export function saveLastCategory(key) {
  try {
    localStorage.setItem(LAST_CATEGORY_KEY, key);
  } catch {
    /* storage unavailable: not critical */
  }
}
