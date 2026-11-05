import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/** Single source of truth for categories, in display order. */
export const CATEGORIES = Object.freeze([
  { key: 'todo', label: 'À faire' },
  { key: 'investigate', label: 'À investiguer' },
  { key: 'read', label: 'À lire' },
  { key: 'watch', label: 'À regarder' },
]);
const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export const TITLE_MAX = 200;
export const URL_MAX = 2048;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  url         TEXT,
  category    TEXT    NOT NULL CHECK (category IN ('todo','investigate','read','watch')),
  done        INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category, done, created_at);
`;

// ---------------------------------------------------------------------------
// Validation (pure functions, also used by tests)
// ---------------------------------------------------------------------------

function validateTitle(title) {
  if (typeof title !== 'string') return { error: 'Le titre est obligatoire.' };
  const t = title.trim();
  if (t.length < 1) return { error: 'Le titre est obligatoire.' };
  if (t.length > TITLE_MAX) return { error: `Le titre doit faire au plus ${TITLE_MAX} caractères.` };
  return { value: t };
}

function validateUrl(url) {
  if (url === undefined || url === null) return { value: null };
  if (typeof url !== 'string') return { error: 'Le lien doit être une URL http(s) valide.' };
  const u = url.trim();
  if (u === '') return { value: null };
  if (u.length > URL_MAX) return { error: `Le lien doit faire au plus ${URL_MAX} caractères.` };
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return { error: 'Le lien doit être une URL http(s) valide.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'Le lien doit commencer par http:// ou https://.' };
  }
  return { value: u };
}

function validateCategory(category) {
  if (typeof category !== 'string' || !CATEGORY_KEYS.includes(category)) {
    return { error: 'Catégorie inconnue.' };
  }
  return { value: category };
}

function isPlainObject(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

export function validateCreate(body) {
  if (!isPlainObject(body)) return { error: 'Corps de requête invalide.' };
  const title = validateTitle(body.title);
  if (title.error) return title;
  const url = validateUrl(body.url);
  if (url.error) return url;
  const category = validateCategory(body.category);
  if (category.error) return category;
  return { value: { title: title.value, url: url.value, category: category.value } };
}

export function validatePatch(body) {
  if (!isPlainObject(body)) return { error: 'Corps de requête invalide.' };
  const out = {};
  if ('title' in body) {
    const r = validateTitle(body.title);
    if (r.error) return r;
    out.title = r.value;
  }
  if ('url' in body) {
    const r = validateUrl(body.url);
    if (r.error) return r;
    out.url = r.value;
  }
  if ('category' in body) {
    const r = validateCategory(body.category);
    if (r.error) return r;
    out.category = r.value;
  }
  if ('done' in body) {
    if (typeof body.done !== 'boolean') return { error: '« done » doit être un booléen.' };
    out.done = body.done ? 1 : 0;
  }
  if (Object.keys(out).length === 0) return { error: 'Aucun champ à modifier.' };
  return { value: out };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

function toItem(row) {
  return {
    id: row.id,
    title: row.title,
    url: row.url ?? null,
    category: row.category,
    done: row.done === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Whitelisted column names: PATCH only ever interpolates these identifiers.
const PATCHABLE_COLUMNS = new Set(['title', 'url', 'category', 'done']);

export function openDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const orderCase = `CASE category ${CATEGORY_KEYS.map((k, i) => `WHEN '${k}' THEN ${i}`).join(' ')} END`;

  const stmts = {
    list: db.prepare(`SELECT * FROM items ORDER BY ${orderCase}, done ASC, created_at DESC, id DESC`),
    get: db.prepare('SELECT * FROM items WHERE id = ?'),
    insert: db.prepare('INSERT INTO items (title, url, category) VALUES (@title, @url, @category)'),
    remove: db.prepare('DELETE FROM items WHERE id = ?'),
  };

  return {
    close: () => db.close(),

    listItems() {
      return stmts.list.all().map(toItem);
    },

    getItem(id) {
      const row = stmts.get.get(id);
      return row ? toItem(row) : null;
    },

    createItem({ title, url, category }) {
      const info = stmts.insert.run({ title, url, category });
      return toItem(stmts.get.get(info.lastInsertRowid));
    },

    updateItem(id, patch) {
      const cols = Object.keys(patch).filter((k) => PATCHABLE_COLUMNS.has(k));
      if (cols.length === 0) return this.getItem(id);
      const setClause = cols.map((c) => `${c} = @${c}`).join(', ');
      const info = db
        .prepare(
          `UPDATE items SET ${setClause}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = @id`,
        )
        .run({ ...Object.fromEntries(cols.map((c) => [c, patch[c]])), id });
      if (info.changes === 0) return null;
      return toItem(stmts.get.get(id));
    },

    deleteItem(id) {
      return stmts.remove.run(id).changes > 0;
    },
  };
}
