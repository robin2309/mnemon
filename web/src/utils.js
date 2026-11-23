export const TITLE_MAX = 200;

/** Single source of truth for categories, in display order (keys mirror the database check). */
export const CATEGORIES = Object.freeze([
  { key: 'todo', label: 'À faire' },
  { key: 'investigate', label: 'À investiguer' },
  { key: 'read', label: 'À lire' },
  { key: 'watch', label: 'À regarder' },
]);
export const CATEGORY_ORDER = CATEGORIES.map((c) => c.key);

/** True only for absolute http(s) URLs. Mirrors the database check. */
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

/** Client-side validation (the database checks again). Returns an error message or null. */
export function validateDraft({ title, url }) {
  const t = title.trim();
  if (!t) return 'Le titre est obligatoire.';
  if (t.length > TITLE_MAX) return `Le titre doit faire au plus ${TITLE_MAX} caractères.`;
  if (url.trim() && !isHttpUrl(url)) return 'Le lien doit être une URL http(s) valide.';
  return null;
}

/** Display order: category order, not-done first, newest first. */
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

/** Database row (snake_case) → item used by the UI. */
export function toItem(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url ?? null,
    category: row.category,
    done: row.done === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Keeps only writable fields, trimmed; an empty link becomes null. */
export function toRow(fields) {
  const row = {};
  if ('title' in fields) row.title = String(fields.title).trim();
  if ('url' in fields) row.url = fields.url == null || String(fields.url).trim() === '' ? null : String(fields.url).trim();
  if ('category' in fields) row.category = fields.category;
  if ('done' in fields) row.done = Boolean(fields.done);
  return row;
}

/**
 * True for keys that must never ship to a browser: new-style secret keys and legacy
 * service_role JWTs. Both bypass row-level security.
 */
export function isSecretKey(key) {
  if (typeof key !== 'string') return false;
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).role === 'service_role';
  } catch {
    return false;
  }
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
