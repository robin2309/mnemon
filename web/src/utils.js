export const TITLE_MAX = 200;

export const CATEGORY_LABEL_MAX = 40;

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

/**
 * Client-side validation (the database checks again). Returns an error message or null.
 * `categories` is checked only when given.
 */
export function validateDraft({ title, url, categories }) {
  const t = title.trim();
  if (!t) return 'Le titre est obligatoire.';
  if (t.length > TITLE_MAX) return `Le titre doit faire au plus ${TITLE_MAX} caractères.`;
  if (url.trim() && !isHttpUrl(url)) return 'Le lien doit être une URL http(s) valide.';
  if (categories && categories.length === 0) return 'Choisissez au moins une catégorie.';
  return null;
}

/** Category name check, mirroring the database. Returns an error message or null. */
export function validateCategoryLabel(label) {
  const l = label.trim();
  if (!l) return 'Le nom de la catégorie est obligatoire.';
  if (l.length > CATEGORY_LABEL_MAX) return `Le nom de la catégorie doit faire au plus ${CATEGORY_LABEL_MAX} caractères.`;
  return null;
}

/** Existing category with this name, ignoring case and surrounding spaces. */
export function findCategoryByLabel(categories, label) {
  const wanted = label.trim().toLocaleLowerCase('fr');
  return categories.find((c) => c.label.toLocaleLowerCase('fr') === wanted) ?? null;
}

/** Display order within a section: not-done first, newest first. */
export function sortItems(items) {
  return [...items].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) ||
      b.id - a.id,
  );
}

/**
 * Database category row → category used by the UI. The key is the id as a string, so it
 * can be used directly as a <select> value or filter key.
 */
export function toCategory(row) {
  return { key: String(row.id), label: row.label };
}

/**
 * Database row (snake_case, with its embedded item_categories) → item used by the UI.
 * `categories` holds category keys in display order (creation order = id order).
 */
export function toItem(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url ?? null,
    categories: (row.item_categories ?? [])
      .map((link) => link.category_id)
      .sort((a, b) => a - b)
      .map(String),
    done: row.done === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Keeps only writable item fields, trimmed; an empty link becomes null. */
export function toRow(fields) {
  const row = {};
  if ('title' in fields) row.title = String(fields.title).trim();
  if ('url' in fields) row.url = fields.url == null || String(fields.url).trim() === '' ? null : String(fields.url).trim();
  if ('done' in fields) row.done = Boolean(fields.done);
  return row;
}

/** Item draft { title, url, categories } → parameters of the create_item / update_item functions. */
export function toItemParams(draft) {
  const { title, url } = toRow({ title: draft.title, url: draft.url });
  return { p_title: title, p_url: url, p_category_ids: [...new Set(draft.categories)].map(Number) };
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

const LAST_CATEGORIES_KEY = 'mnemon.lastCategories';
// Older keys: one category per item ('mnemon.lastCategory', 'ideas.lastCategory' before
// the app became Mnémon). They held fixed names, not ids, so they are just dropped.
const LEGACY_KEYS = ['mnemon.lastCategory', 'ideas.lastCategory'];

/** Category keys picked for the previous item (may include deleted ones). */
export function loadLastCategories() {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
    const value = JSON.parse(localStorage.getItem(LAST_CATEGORIES_KEY) ?? '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

export function saveLastCategories(keys) {
  try {
    localStorage.setItem(LAST_CATEGORIES_KEY, JSON.stringify(keys));
  } catch {
    /* storage unavailable: not critical */
  }
}
