// The import script's SQL must run cleanly against the real schema.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from './helpers/pg.js';

const A = '11111111-1111-1111-1111-111111111111';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemon-import-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function runImport(file) {
  return execFileSync(process.execPath, ['scripts/import.js', file, '--email', 'user0@example.com'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Items with the labels of their categories (in category order) as `categories`. */
async function itemsWithCategories(db) {
  const { rows } = await db.query(
    `select i.user_id, i.title, i.url, i.done, i.created_at::text as created,
            array(select c.label from public.item_categories ic join public.categories c on c.id = ic.category_id
                  where ic.item_id = i.id order by c.id) as categories
     from public.items i order by i.id`,
  );
  return rows;
}

async function labels(db) {
  return (await db.query('select label from public.categories order by id')).rows.map((r) => r.label);
}

test('imports a SQLite database from the Fly.io version', async () => {
  const file = path.join(tmp, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT, url TEXT, category TEXT, done INTEGER,
    created_at TEXT, updated_at TEXT)`);
  const insert = old.prepare('INSERT INTO items (title, url, category, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run("L'Étranger", null, 'read', 1, '2025-03-01T10:00:00.000Z', '2025-03-02T10:00:00.000Z');
  insert.run('Vidéo', 'https://youtube.com/watch?v=x', 'watch', 0, '2025-04-01T10:00:00.000Z', '2025-04-01T10:00:00.000Z');
  insert.run('Bad', 'javascript:alert(1)', 'todo', 0, '2025-04-01T10:00:00.000Z', '2025-04-01T10:00:00.000Z');
  old.close();

  const { db } = await createDatabase([A]);
  await db.exec(runImport(file));
  const rows = await itemsWithCategories(db);
  assert.deepEqual(
    rows.map(({ user_id, title, url, categories, done }) => ({ user_id, title, url, categories, done })),
    [
      { user_id: A, title: "L'Étranger", url: null, categories: ['À lire'], done: true },
      { user_id: A, title: 'Vidéo', url: 'https://youtube.com/watch?v=x', categories: ['À regarder'], done: false },
    ],
  );
  assert.match(rows[0].created, /^2025-03-01 10:00:00/);
  // The defaults already existed: nothing duplicated.
  assert.deepEqual(await labels(db), ['À faire', 'À investiguer', 'À lire', 'À regarder']);
  await db.close();
});

test('restores a version 2 JSON export, creating missing categories', async () => {
  const file = path.join(tmp, 'backup-v2.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      app: 'mnemon',
      version: 2,
      categories: ['À faire', 'Podcasts', 'À lire'],
      items: [
        { id: 9, title: 'Épisode', url: null, category: 'podcasts', done: false, created_at: '2026-01-01T00:00:00Z' },
        { id: 10, title: 'Courses', url: null, category: 'À faire', done: true, created_at: '2026-01-02T00:00:00Z' },
        { id: 11, title: 'Film', url: null, category: 'Cinéma', done: false, created_at: '2026-01-03T00:00:00Z' },
      ],
    }),
  );
  const { db } = await createDatabase([A]);
  await db.exec(runImport(file));
  assert.deepEqual(await labels(db), ['À faire', 'À investiguer', 'À lire', 'À regarder', 'Podcasts', 'Cinéma']);
  assert.deepEqual(
    (await itemsWithCategories(db)).map((r) => [r.title, r.categories, r.done]),
    [['Épisode', ['Podcasts'], false], ['Courses', ['À faire'], true], ['Film', ['Cinéma'], false]],
  );
  await db.close();
});

test('restores a version 3 JSON export with several categories per item', async () => {
  const file = path.join(tmp, 'backup-v3.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      app: 'mnemon',
      version: 3,
      categories: ['À faire', 'À lire', "Jeux d'été"],
      items: [
        { title: "L'été $$ dollars", url: null, categories: ["jeux d'été", 'À lire', 'À lire'], done: false },
        { title: 'Sans catégorie', url: null, categories: ['  '], done: false },
        { title: 'Courses', url: null, categories: ['À faire'], done: true, created_at: '2026-01-02T00:00:00Z' },
      ],
    }),
  );
  const { db } = await createDatabase([A]);
  await db.exec(runImport(file));
  assert.deepEqual(await labels(db), ['À faire', 'À investiguer', 'À lire', 'À regarder', "Jeux d'été"]);
  assert.deepEqual(
    (await itemsWithCategories(db)).map((r) => [r.title, r.categories]),
    [["L'été $$ dollars", ['À lire', "Jeux d'été"]], ['Courses', ['À faire']]],
  );
  await db.close();
});

test('restores a version 1 JSON export and refuses an unknown email', async () => {
  const file = path.join(tmp, 'backup-v1.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      app: 'mnemon',
      version: 1,
      items: [{ id: 9, title: 'Todo', url: null, category: 'todo', done: false, created_at: '2026-01-01T00:00:00Z' }],
    }),
  );
  const { db } = await createDatabase([A]);
  const sql = runImport(file);
  await db.exec(sql);
  assert.deepEqual((await itemsWithCategories(db)).map((r) => r.categories), [['À faire']]);

  const { db: other } = await createDatabase([]);
  await assert.rejects(other.exec(sql), /No Supabase user with email/);
  await db.close();
  await other.close();
});
